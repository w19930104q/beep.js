/*


	Voice lifecycle tests


	Loads the real Beep sources against a FakeAudioContext and
	asserts, for high-polyphony rapid play/pause/replay usage:

	  1.  Each note’s gain events arrive in attack → sustain →
	      release order, with no duplicated envelope segments.
	  2.  No voice ever spawns a duplicate oscillator, and a
	      stale release timer from an old play() never mutes a
	      fresh envelope.
	  3.  After Beep.reset() every voice’s gain reads zero and
	      no timers remain pending.

	Run with:  node test/voice-lifecycle.test.js

*/


'use strict'

var
fs   = require( 'fs' ),
path = require( 'path' ),
vm   = require( 'vm' ),
fake = require( './FakeAudioContext.js' )


//  ── Browser-global stubs ─────────────────────────────────────
//  Beep.js expects window, document, GainNode, and an
//  AudioContext constructor. Give it fakes.

global.window = {

	AudioContext: fake.FakeAudioContext
}
global.document = {

	addEventListener: function(){},
	getElementById:   function(){ return null }
}
global.GainNode = fake.FakeGainNode


//  Load the real sources into this global scope.
//  (They declare `var Beep = …` etc. at top level.)

;[ 'Beep.js', 'Beep.Note.js', 'Beep.Voice.js' ].forEach( function( file ){

	var code = fs.readFileSync( path.join( __dirname, '..', 'beep', file ), 'utf8' )

	vm.runInThisContext( code, { filename: file })
})


//  ── Tiny assertion kit ───────────────────────────────────────

var
passes = 0,
failures = []

function assert( condition, message ){

	if( condition ){ passes ++ }
	else {

		failures.push( message )
		console.error( '  ✗ ' + message )
	}
}
function section( title ){

	console.log( '\n' + title )
}


//  Extract the ordered gain-envelope events for a voice.

function gainEvents( voice ){

	return voice.gainNode.gain.events
}
function ramps( voice ){

	return gainEvents( voice ).filter( function( e ){

		return e.method === 'linearRampToValueAtTime'
	})
}


//  ════════════════════════════════════════════════════════════
//  1. Single note: attack → sustain → release ordering
//  ════════════════════════════════════════════════════════════

section( '1. Single note ADSR ordering' )

var timers = fake.installFakeTimers( global )

Beep.audioContext = new fake.FakeAudioContext()

var voiceA = new Beep.Voice( '3E♭' )
	.setOscillatorType( 'square' )
	.setAttackGain( 0.3 )
	.setAttackDuration( 0.08 )
	.setDecayDuration( 0.1 )
	.setSustainGain( 0.6 )
	.setSustainDuration( 1 )
	.setReleaseDuration( 0.1 )

assert( typeof voiceA.setAttackGain( 0.3 ).play === 'function', 'setters return the voice (chainable)' )
assert( voiceA.play( 0.5 ) === voiceA, 'play() returns the voice (chainable)' )

var evts = gainEvents( voiceA )

assert( evts[ 0 ].method === 'cancelScheduledValues', 'play() begins by cancelling scheduled values' )
assert( evts[ 1 ].method === 'setValueAtTime' && evts[ 1 ].value === 0, 'play() anchors at current gain (0)' )

var r = ramps( voiceA )

assert( r.length === 2, 'attack + decay produce exactly two ramps, got ' + r.length )
assert( Math.abs( r[ 0 ].value - 0.5 * 0.3 ) < 1e-9, 'attack ramp targets velocity × attackGain' )
assert( Math.abs( r[ 0 ].time - 0.08 ) < 1e-9, 'attack ramp lands at attackDuration' )
assert( Math.abs( r[ 1 ].value - 0.5 * 0.3 * 0.6 ) < 1e-9, 'sustain ramp targets velocity × attackGain × sustainGain' )
assert( Math.abs( r[ 1 ].time - 0.18 ) < 1e-9, 'sustain ramp lands at attack + decay' )
assert( r[ 0 ].time < r[ 1 ].time, 'attack is scheduled before sustain' )

assert( Beep.audioContext.oscillators.length === 1, 'exactly one oscillator created' )
assert( Beep.audioContext.oscillators[ 0 ].starts === 1, 'oscillator started exactly once' )
assert( timers.pendingCount() === 1, 'finite sustain schedules exactly one auto-pause timer' )

//  Let the sustain expire → auto-pause → release.

Beep.audioContext.currentTime = 1.2
timers.tick( 2000 )

assert( timers.pendingCount() === 0, 'auto-pause timer consumed after firing' )

var rel = gainEvents( voiceA ).slice( 4 )//  Events after the play() envelope.

assert( rel[ 0 ].method === 'cancelScheduledValues', 'release begins by cancelling scheduled values' )
assert( rel[ 1 ].method === 'setValueAtTime', 'release anchors at current gain' )
assert( rel[ 2 ].method === 'linearRampToValueAtTime' && rel[ 2 ].value < 0.001, 'release ramps toward silence' )
assert( Math.abs( rel[ 2 ].time - 1.3 ) < 1e-9, 'release ramp lands at now + releaseDuration' )
assert( rel[ 3 ].method === 'setValueAtTime' && rel[ 3 ].value === 0, 'release ends with a hard zero' )
assert( rel[ 2 ].time > r[ 1 ].time, 'release is scheduled after sustain' )


//  ════════════════════════════════════════════════════════════
//  2. Rapid play / pause / replay: no stale timers, no
//     duplicate oscillators, no doubled envelopes
//  ════════════════════════════════════════════════════════════

section( '2. Rapid play/pause/replay' )

var ctxB = new fake.FakeAudioContext()

Beep.audioContext = ctxB

var voiceB = new Beep.Voice( 220 ).setSustainDuration( 5 ).setReleaseDuration( 0.1 )

voiceB.play( 0.8 )
assert( timers.pendingCount() === 1, 'first play() arms one auto-pause timer' )

//  Replay quickly — the old release timer must be cancelled,
//  not left to mute the new envelope mid-flight.

ctxB.currentTime = 0.3
voiceB.pause()
assert( timers.pendingCount() === 0, 'manual pause() clears the pending auto-pause timer' )

var pauseEventCount = gainEvents( voiceB ).filter( function( e ){

	return e.method === 'linearRampToValueAtTime' && e.value < 0.001

}).length

ctxB.currentTime = 0.4
voiceB.play( 0.8 )
assert( timers.pendingCount() === 1, 'replay arms exactly one new timer (old one is gone)' )
assert( ctxB.oscillators.length === 1, 'replay creates no duplicate oscillator' )
assert( ctxB.oscillators[ 0 ].starts === 1, 'oscillator still started only once' )

//  Advance past where the ORIGINAL timer would have fired.
//  If it were still alive it would have paused the voice here.

ctxB.currentTime = 3.0
timers.tick( 2900 )

var releaseRamps = gainEvents( voiceB ).filter( function( e ){

	return e.method === 'linearRampToValueAtTime' && e.value < 0.001

}).length

assert( releaseRamps === pauseEventCount, 'no stale release timer fired after replay' )

//  Now let the legitimate timer fire.

ctxB.currentTime = 6.0
timers.tick( 3000 )
releaseRamps = gainEvents( voiceB ).filter( function( e ){

	return e.method === 'linearRampToValueAtTime' && e.value < 0.001

}).length
assert( releaseRamps === pauseEventCount + 1, 'exactly one new release envelope from the live timer' )
assert( timers.pendingCount() === 0, 'no timers left after auto-pause fires' )
assert( voiceB.play() === voiceB && voiceB.pause() === voiceB, 'play()/pause() remain chainable' )


//  ════════════════════════════════════════════════════════════
//  3. Polyphony + reset: gains and timers all return to zero
//  ════════════════════════════════════════════════════════════

section( '3. Polyphonic reset' )

var ctxC = new fake.FakeAudioContext()

Beep.audioContext = ctxC

var
notes  = [ '4C', '4E', '4G', '5C' ],
chord  = notes.map( function( n ){

	return new Beep.Voice( n ).setSustainDuration( 2 ).play( 0.7 )
})

assert( ctxC.oscillators.length === 4, 'four voices → four oscillators' )
assert( timers.pendingCount() === 4, 'four voices → four pending auto-pause timers' )
assert( Beep.voices.length >= 4, 'voices registered in Beep.voices' )

ctxC.currentTime = 1.0
Beep.reset()

assert( Beep.voices.length === 0, 'reset empties the voice registry' )
assert( timers.pendingCount() === 0, 'reset leaves zero pending timers' )

chord.forEach( function( v, i ){

	var g = v.gainNode.gain

	assert( v.isTorndown === true, 'voice ' + i + ' is torn down' )
	assert( g.value === 0, 'voice ' + i + ' gain value is zero after reset' )
	assert( g.events[ g.events.length - 1 ].method === 'setValueAtTime' &&
		g.events[ g.events.length - 1 ].value === 0,
		'voice ' + i + ' final gain event is a hard zero' )
	assert( ctxC.oscillators[ i ].stops === 1, 'voice ' + i + ' oscillator stopped exactly once' )
})

//  A torn-down voice must stay silent even if poked.

var eventCountAfterReset = gainEvents( chord[ 0 ] ).length

chord[ 0 ].play().pause()
assert( gainEvents( chord[ 0 ] ).length === eventCountAfterReset, 'torn-down voice ignores play()/pause()' )
assert( ctxC.oscillators[ 0 ].starts === 1, 'torn-down voice does not restart its oscillator' )
assert( timers.pendingCount() === 0, 'torn-down voice arms no new timers' )


//  ── Tally ────────────────────────────────────────────────────

timers.restore()
console.log( '\n' + passes + ' passed, ' + failures.length + ' failed' )
process.exit( failures.length ? 1 : 0 )
