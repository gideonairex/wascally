var amqp = require( 'amqplib' );
var _ = require( 'lodash' );
var fs = require( 'fs' );
var when = require( 'when' );
var AmqpConnection = require( 'amqplib/lib/callback_model' ).CallbackModel;
var Promiser = require( './promiseMachine.js');

function getOption( opts, key, alt ) {
	if( opts.get ) {
		return opts.get( key, alt );
	} else {
		return opts[ key ] || alt;
	}
}

function getUri( protocol, user, pass, server, port, vhost, heartbeat ) {
	return protocol + user + ':' + pass +
		'@' + server + ':' + port + '/' + vhost +
		'?heartbeat=' + heartbeat;
}

function split( x ) {
	if( _.isNumber( x ) ) {
		return [ x ];
	} else if( _.isArray( x ) ) {
		return x;
	} else {
		return x.split( ',' ).map( trim );
	}
}

function trim ( x ) { 
	return x.trim( ' ' ); 
}

var Adapter = function( parameters ) {
	var serverList = getOption( parameters, 'RABBIT_BROKER' ) || getOption( parameters, 'server', 'localhost' ),
		portList = getOption( parameters, 'RABBIT_PORT', 5672 );

	this.name = parameters ? ( parameters.name || 'default' ) : 'default';
	this.connectionIndex = 0;
	this.servers = split( serverList );
	this.ports = split( portList );
	this.heartbeat = getOption( parameters, 'RABBIT_HEARTBEAT' ) || getOption( parameters, 'heartbeat', 2000 );
	this.protocol = getOption( parameters, 'RABBIT_PROTOCOL' ) || getOption( parameters, 'protocol', 'amqp://' );
	this.pass = getOption( parameters, 'RABBIT_PASSWORD' ) || getOption( parameters, 'pass', 'guest' );
	this.user = getOption( parameters, 'RABBIT_USER' ) || getOption( parameters, 'user', 'guest' );
	this.vhost = getOption( parameters, 'RABBIT_VHOST' ) || getOption( parameters, 'vhost', '%2f' );
	var certPath = getOption( parameters, 'RABBIT_CERT' ) || getOption( parameters, 'certPath' );
	var keyPath = getOption( parameters, 'RABBIT_KEY' ) || getOption( parameters, 'keyPath' );
	var caPaths = getOption( parameters, 'RABBIT_CA' ) || getOption( parameters, 'caPath' );
	var passphrase = getOption( parameters, 'RABBIT_PASSPHRASE' ) || getOption( parameters, 'passphrase' );
	var pfxPath = getOption( parameters, 'RABBIT_PFX' ) || getOption( parameters, 'pfxPath' );
	var useSSL = certPath || keyPath || passphrase || caPaths || pfxPath;
	this.options = { noDelay: true };
	if( certPath ) {
		this.options.cert = fs.readFileSync( certPath );
	}
	if( keyPath ) {
		this.options.key = fs.readFileSync( keyPath );
	}
	if( passphrase ) {
		this.options.passphrase = passphrase;
	}
	if( pfxPath ) {
		this.options.pfx = fs.readFileSync( pfxPath );
	}
	if( caPaths ) {
		var list = caPaths.split( ',' );
		this.options.ca = _.map( list, function( caPath ) { 
			return fs.readFileSync( caPath ); 
		} );
	}
	if( useSSL ) {
		this.protocol = 'amqps';
	}
	this.limit = _.max( [ this.servers.length, this.ports.length ] );
};

Adapter.prototype.connect = function() {
	return when.promise( function( resolve, reject ) {
		var attempted = [],
			attempt;	
		attempt = function() {
			var nextUri = this.getNextUri();
			if( _.indexOf( attempted, nextUri ) < 0 ) {
				amqp.connect( nextUri, this.options )
					.then( resolve )
					.then( null, function( err ) {
						attempted.push( nextUri );
						this.bumpIndex();
						attempt( err );
					}.bind( this ) );
			} else {
				reject( 'No endpoints could be reached' );
			}
		}.bind( this );
		attempt();
	}.bind( this ) );
};

Adapter.prototype.bumpIndex = function() {
	if( this.limit - 1 > this.connectionIndex ) {
		this.connectionIndex ++;
	} else {
		this.connectionIndex = 0;
	}
};

Adapter.prototype.getNextUri = function() {
	var server = this.getNext( this.servers ),
		port = this.getNext( this.ports );
		uri = getUri( this.protocol, this.user, this.pass, server, port, this.vhost, this.heartbeat );
	return uri;
};

Adapter.prototype.getNext = function( list ) {
	if( this.connectionIndex >= list.length ) {
		return list[ 0 ];
	} else {
		return list[ this.connectionIndex ];
	}
};

module.exports = function( options ) {
		var close = function( connection ) {
			connection.close();
		};
		var adapter = new Adapter( options );
		return Promiser( adapter.connect.bind( adapter ), AmqpConnection, close, 'close' );
};