/*
This script runs a local REST-ish server that can be used to update user & trade details in MongoDB.
The server will run on port secrets.mongoUpdaterPort and update the DB at secrets.mongoUri.
*/

var mongodb = require('mongodb');
var express = require('express');
var winston = require('winston');
var async = require('async');
var moment = require('moment');

var secrets = require('./secrets.js').secrets;

var winstonOpts = { timestamp: true, colorize: false, level: 'info' };
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, winstonOpts);

var app = express();

mongodb.connect(secrets.mongoUri, function (err, dbClient) {
	if (err) {
		winston.err('Error connecting to MongoDB:', err);
		process.exit(1);
	}

	// GET /user/<userId> - returns user record as JSON
	app.get('/user/:userId', function (req, res) {
		var userId = req.params.userId;
		getCollection(dbClient, 'users', res, function(collection) {
			collection.findOne({ _id: userId }, function (err, record) {
				if (err) {
					winston.error('Error finding user ' + userId + ':', err);
					res.status(500).send('Error finding user ' + userId);
					return;
				} 

				record ? res.json(record) : res.status(404).send('No user found with id ' + userId);
			});
		});
	});

	// GET /users/friends - returns JSON list of all user details with isFriend set to true
	app.get('/users/friends', function (req, res) {
		getCollection(dbClient, 'users', res, function(collection) {
			collection.find({ isFriend: true }).toArray(function (err, results) {
				if (err) {
					winston.error('Error finding friends :', err);
					res.status(500).send('Error finding friends');
					return;
				} 

				res.json(results);
			});
		});
	});

	// GET /daily-trades/<id> - get today's daily trades record as JSON
	//app.get('/daily-trades/:userId/:day', function (req, res) {
	app.get('/daily-trades/:userId', function (req, res) {
		var userId = req.params.userId;
		//var day = req.params.day;
		var day = moment().format('YYYY-MM-DD');
		getCollection(dbClient, 'daily-trades', res, function(collection) {
			collection.findOne({ userId: userId, day: day }, function (err, record) {
				if (err) {
					winston.error('Error finding daily trades for user ' + userId + ' and day ' + day + ':', err);
					res.status(500).send('Error finding daily trades for user ' + userId + ' and day ' + day);
					return;
				} 

				res.json(record); // Return null if nothing is found for the user/day
			});
		});
	});

	// POST /user/<id>/added - updates user record: set isFriend to true, set lastAddedTime to now, increment numTimesAdded
	app.post('/user/:userId/added', function (req, res) {
		var userId = req.params.userId;
		getCollection(dbClient, 'users', res, function(collection) {
			var updates = { $set: { isFriend: true, lastAddedTime: new Date().getTime() }, $inc: { numTimesAdded: 1 } };
			collection.update({ _id: userId }, updates, { upsert: true }, function (err) {
				if (err) {
					winston.error('Error updating added user details ' + userId + ':', err);
					res.status(500).send('Error updating added user details ' + userId);
					return;
				} 
				res.status(204).send();
			});
		});
	});

	// POST /user/<id>/removed - set isFriend to false
	app.post('/user/:userId/removed', function (req, res) {
		var userId = req.params.userId;
		getCollection(dbClient, 'users', res, function(collection) {
			var updates = { $set: { isFriend: false } };
			collection.update({ _id: userId }, updates, function (err) {
				if (err) {
					winston.error('Error updating removed user details ' + userId + ':', err);
					res.status(500).send('Error updating removed user details ' + userId);
					return;
				} 
				res.status(204).send();
			});
		});
	});

	// POST /user/<id>/trade-declined - update user record: increment numTradesDeclined
	app.post('/user/:userId/trade-declined', function (req, res) {
		var userId = req.params.userId;
		getCollection(dbClient, 'users', res, function(collection) {
			var updates = { $inc: { numTradesDeclined: 1 } };
			collection.update({ _id: userId }, updates, function (err) {
				if (err) {
					winston.error('Error updating declined trade user details ' + userId + ':', err);
					res.status(500).send('Error updating declined trade user details ' + userId);
					return;
				} 
				res.status(204).send();
			});
		});
	});

	// POST /user/<id>/trade-accepted - update user record: increment numTradesAccepted
	app.post('/user/:userId/trade-accepted', function (req, res) {
		var userId = req.params.userId;
		getCollection(dbClient, 'users', res, function(collection) {
			var updates = { $inc: { numTradesAccepted: 1 } };
			collection.update({ _id: userId }, updates, function (err) {
				if (err) {
					winston.error('Error updating accepted trade user details ' + userId + ':', err);
					res.status(500).send('Error updating accepted trade user details ' + userId);
					return;
				} 
				res.status(204).send();
			});
		});
	});

	// POST /trade/<userId>/<tradeId>/<itemId>/<wasClaimed> 
	//  - update trade record, set time to now
    //  - update user record, increment numItemsClaimed or numItemsDonated
    //  - update daily trades record, increment numItemsClaimed or numItemsDonated
	app.post('/trade/:userId/:tradeId/:itemId/:wasClaimed', function (req, res) {
		var userId = req.params.userId;
		var tradeId = req.params.tradeId;
		var itemId = req.params.itemId;
		var wasClaimed = req.params.wasClaimed == 'true';

		var incUpdates = { $inc: {} };
		if (wasClaimed) {
			incUpdates['$inc'].numItemsClaimed = 1;
		}
		else {
			incUpdates['$inc'].numItemsDonated = 1;
		}

		var day = 

		async.parallel([
			function (callback) {
				getCollection(dbClient, 'daily-trades', res, function(collection) {
					var day = moment().format('YYYY-MM-DD');
					collection.update({ userId: userId, day: day }, incUpdates, { upsert: true }, callback);
				});
			},
			function (callback) {
				getCollection(dbClient, 'trades', res, function(collection) {
					var tradeRecord = {
						userId: userId,
						tradeId: tradeId,
						time: new Date().getTime(),
						itemId: itemId,
						wasClaimed: wasClaimed
					};
					collection.insert(tradeRecord, callback);
				});
			},
			function (callback) {
				getCollection(dbClient, 'users', res, function(collection) {
					collection.update({ _id: userId }, incUpdates, callback);
				});
			}
		], function(err, results) {
			if (err) {
				winston.error('Error updating details for trade ' + userId + '/' + tradeId + '/' + itemId + '/' + wasClaimed + ':', err);
				res.status(500).send('Error updating details for trade ' + userId + '/' + tradeId + '/' + itemId + '/' + wasClaimed);
				return;
			}
			res.status(204).send();
		});
	});


	app.listen(secrets.mongoUpdaterPort, function () {
		winston.info('Mongo updater server listening on port ' + secrets.mongoUpdaterPort);
	});
});

// Helper function to return a collection or set a 500 response
function getCollection(client, collectionName, res, callback) {
	client.collection(collectionName, function (err, collection) {
		if (err) {
			winston.error('Error loading ' + collectionName + ' collection:', err);
			res.status(500).send('Error loading ' + collectionName + ' collection');
			return;
		}
		callback(collection)
	});
}