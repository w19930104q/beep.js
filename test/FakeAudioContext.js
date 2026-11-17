/*


	FakeAudioContext


	A test double for the Web Audio API that RECORDS every event
	instead of making sound. Each AudioParam method call is logged
	with the context’s (fake) currentTime so tests can assert the
	exact ordering of attack / sustain / release envelope events.

	Also provides a fake timer system (installFakeTimers) so tests
	can assert that no stale setTimeout survives a reset.

*/


function FakeAudioParam( name, context, initialValue ){

	this.name    = name
	this.context = context
	this.value   = initialValue || 0
	this.events  = []//  This param’s own event log.
}
;[ 'setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime' ]

.forEach( function( methodName ){

	FakeAudioParam.prototype[ methodName ] = function( value, time ){

		var event = {

			t:      this.context.currentTime,//  When the call was made.
			method: methodName,
			value:  value,
			time:   time//  The scheduled (absolute) time.
		}
		this.events.push( event )
		this.context.eventLog.push({

			param: this.name,
			t:     event.t,
			method: methodName,
			value: value,
			time:  time
		})
		return this
	}
})
FakeAudioParam.prototype.cancelScheduledValues = function( time ){

	var event = { t: this.context.currentTime, method: 'cancelScheduledValues', time: time }

	this.events.push( event )
	this.context.eventLog.push({

		param: this.name,
		t:     event.t,
		method: 'cancelScheduledValues',
		time:  time
	})
	return this
}


function FakeGainNode( context ){

	this.audioContext = context
	this.gain = new FakeAudioParam( 'gain', context, 1 )
	this.connections = []
}
FakeGainNode.prototype.connect = function( destination ){

	this.connections.push( destination )
	this.audioContext.eventLog.push({ param: 'gainNode', t: this.audioContext.currentTime, method: 'connect' })
}
FakeGainNode.prototype.disconnect = function(){

	this.connections.length = 0
	this.audioContext.eventLog.push({ param: 'gainNode', t: this.audioContext.currentTime, method: 'disconnect' })
}


function FakeOscillatorNode( context ){

	this.audioContext = context
	this.type = 'sine'
	this.frequency = new FakeAudioParam( 'frequency', context, 0 )
	this.starts = 0
	this.stops  = 0
	this.connections = []
}
FakeOscillatorNode.prototype.connect = function( destination ){

	this.connections.push( destination )
}
FakeOscillatorNode.prototype.disconnect = function(){

	this.connections.length = 0
}
FakeOscillatorNode.prototype.start = function( when ){

	this.starts ++
	this.audioContext.eventLog.push({ param: 'oscillator', t: this.audioContext.currentTime, method: 'start', time: when })
}
FakeOscillatorNode.prototype.stop = function( when ){

	this.stops ++
	this.audioContext.eventLog.push({ param: 'oscillator', t: this.audioContext.currentTime, method: 'stop', time: when })
}


function FakeAudioContext(){

	this.currentTime = 0
	this.destination = { name: 'destination' }
	this.eventLog    = []//  Every recorded event, in call order.
	this.oscillators = []//  Every oscillator ever created.
	this.gainNodes   = []
}
FakeAudioContext.prototype.createGain = function(){

	var node = new FakeGainNode( this )

	this.gainNodes.push( node )
	return node
}
FakeAudioContext.prototype.createOscillator = function(){

	var node = new FakeOscillatorNode( this )

	this.oscillators.push( node )
	return node
}


//  Fake timers: a manually-advanced clock so tests can prove
//  that no stale release timer survives play/pause/teardown.

function installFakeTimers( globalObject ){

	var
	timers  = [],
	nextID  = 1,
	now     = 0,
	realSetTimeout    = globalObject.setTimeout,
	realClearTimeout  = globalObject.clearTimeout

	globalObject.setTimeout = function( fn, delay ){

		var timer = { id: nextID ++, fn: fn, at: now + ( delay || 0 ), cancelled: false, fired: false }

		timers.push( timer )
		return timer.id
	}
	globalObject.clearTimeout = function( id ){

		timers.forEach( function( timer ){

			if( timer.id === id ) timer.cancelled = true
		})
	}

	return {

		pendingCount: function(){

			return timers.filter( function( t ){ return t.cancelled === false && t.fired !== true } ).length
		},

		//  Advance the fake clock by `ms`, firing every timer
		//  whose deadline falls within the window, in deadline
		//  order. Timers scheduled by other timers during the
		//  tick are also considered.

		tick: function( ms ){

			var
			deadline = now + ms,
			next, i

			while( true ){

				next = null
				for( i = 0; i < timers.length; i ++ ){

					if( timers[ i ].cancelled === false &&
						timers[ i ].fired === false &&
						timers[ i ].at <= deadline &&
						( next === null || timers[ i ].at < next.at ||
							( timers[ i ].at === next.at && timers[ i ].id < next.id ))){

						next = timers[ i ]
					}
				}
				if( next === null ) break
				next.fired = true
				now = next.at
				next.fn()
			}
			now = deadline
		},
		restore: function(){

			globalObject.setTimeout   = realSetTimeout
			globalObject.clearTimeout = realClearTimeout
		}
	}
}


if( typeof module !== 'undefined' && module.exports ){

	module.exports = {

		FakeAudioContext:   FakeAudioContext,
		FakeAudioParam:     FakeAudioParam,
		FakeGainNode:       FakeGainNode,
		FakeOscillatorNode: FakeOscillatorNode,
		installFakeTimers:  installFakeTimers
	}
}
