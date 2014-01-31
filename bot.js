var fs = require('fs');
var crypto = require('crypto');

var steam = require('steam');
var SteamTrade = require('steam-trade');
var winston = require('winston');
var request = require('request');
var cheerio = require('cheerio');
var uuid = require('node-uuid');
var phantom = require('node-phantom');
var async = require('async');
var _ = require('underscore');

var secrets = require('./secrets.js').secrets;

var serversFile = 'servers';
var sentryFile = 'sentry';
var webSessionId = null;
var cookies = null;
var canTrade = false;
var paused = false;
var respondingToTradeRequests = false; // True when using PhantomJS to accept web-based trades
var autoFriendRemoveTimeout = 24*60*60*1000; // 1 day

var sendInstructions1 = "If you want to give me something, offer it for trade, check ready, and I'll check ready soon after.";
var sendInstructions2 = "Click Make Trade when you're sure you want to send me your items.";
var takeInstructions1 = "If you want me to send you something from my inventory, go to my inventory:";
var takeInstructions2 = 'http://steamcommunity.com/id/' + secrets.profileId + '/inventory/ ,';
var takeInstructions3 = 'then right click on what you want and select "Copy Link Address", then paste that into this trade';
var takeInstructions4 = 'chat window and I\'ll add the item. Check ready then click Make Trade when you\'re ready.';
var tradeCompleteMessage = "Trade complete! Please remember to remove me from your friends list if you don't want to make any more trades so that other \
people can trade with me. If you want to make trades later you can always re-add me.";
var wrongLinkMessage = 'It looks like you selected "Copy Page URL", you need to select "Copy Link Address"';
var badLinkMessage = 'I don\'t recognise that link.';
var itemNotFoundMessage = "I can't find that item, you may need to refresh my inventory page or try to copy the link again.";
var welcomeMessage = "Hello! To give me your trash or get something from my inventory, invite me to trade and I'll give you instructions there. \
Trade offers should also work but they don't work all the time. \
Please remember to remove me from your friends list after you are done so that my friends list doesn't fill up, I will automatically remove you as a friend if you don't. \
If you want to make trades later you can always re-add me.";
var chatResponse = "Hello! To give me your trash or get something from my inventory, invite me to trade and I'll give you instructions there.";
var pausedMessage = "Sorry, I can't trade right now. I'll set my status as Looking to Trade when I'm ready to accept requests again.";
var notReadyMessage = "Sorry, I can't accept a trade request right now, wait a few minutes and try again.";
var cantAddMessage = "Sorry, I can't add that item, it might not be tradable.";
var addedMessage = "Item added, click ready when you want to make the trade";

// Turn on timestamps
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {'timestamp':true});

if (fs.existsSync(serversFile)) {
	steam.servers = JSON.parse(fs.readFileSync(serversFile));
}
else {
	winston.warn("No servers file found, using defaults");
}

var sentry = undefined;
if (fs.existsSync(sentryFile)) {
	sentry = fs.readFileSync(sentryFile);
}

var bot = new steam.SteamClient();

//winston.info("Logging in with username " + secrets.username + " password " + secrets.password + " guardCode " + secrets.guardCode);
bot.logOn({ accountName: secrets.username, password: secrets.password, authCode: secrets.guardCode, shaSentryfile: sentry });

// Continuously try to connect if disconnected
setInterval(function() { 
	if (!bot.loggedOn) {
		bot.logOn(secrets.username, secrets.password, sentry, secrets.guardCode);
	}
}, 60*1000);

bot.on('loggedOn', function() { 
	winston.info("Logged on");
	bot.setPersonaState(steam.EPersonaState.Online);
	canTrade = false;
});

bot.on('error', function(error) { 
	winston.error("Caught Steam error", error);
	canTrade = false;
});

bot.on('loggedOff', function() { 
	winston.error("Logged off from Steam");
	canTrade = false;
});

bot.on('sentry', function(buffer) { 
	winston.info("Sentry event fired");
	fs.writeFile(sentryFile, buffer);
});

bot.on('servers', function(servers) {
	fs.writeFile(serversFile, JSON.stringify(servers));
});

// Auto-accept friends, auto-remove after autoFriendRemoveTimeout
bot.on('friend', function(userId, relationship) { 
	winston.info("friend event for " + userId + " type " + relationship);
	if (relationship == steam.EFriendRelationship.PendingInvitee && !_.contains(secrets.blacklist, steamId)) {
		winston.info("added " + userId + " as a friend");
		bot.addFriend(userId);
		setTimeout(function() {
			bot.sendMessage(userId, welcomeMessage);
		}, 5000);
		setTimeout(function() {
			if (!_.contains(secrets.whitelist, userId) && userId != secrets.ownerId) {
				winston.info("automatically removing " + userId + " as a friend");
				bot.removeFriend(userId);
			}
		}, autoFriendRemoveTimeout);
	}
});


bot.on('friendMsg', function(userId, message, entryType) { 
	winston.info("friendMsg event for " + userId + " entryType " + entryType + " message " + message);
	if (entryType == steam.EChatEntryType.ChatMsg) {

		if (userId == secrets.ownerId) {
			if (message.indexOf('game ') == 0) {
				var gameId = message.substring('game '.length);
				bot.gamesPlayed([gameId]);
				return;
			}

			switch (message) {
			case 'pause':
				paused = true;
				bot.setPersonaState(steam.EPersonaState.Snooze);
				winston.info("PAUSED");
				return;
			case 'unpause':
				paused = false;
				bot.setPersonaState(steam.EPersonaState.LookingToTrade);
				winston.info("UNPAUSED");
				return;
			case 'export':
				getInventoryHistory();
				return;
			case 'offers':
				acceptAllTradeOffers();
				return;
			case 'unfriend':
				removeAllFriends();
				return;
			case 'friend':
				addPendingFriends();
				return;
			default: 
				bot.sendMessage(userId, "Unrecognized command");
				return;
			}
		}
		else {
			bot.sendMessage(userId, chatResponse);
		}
	}
});

bot.on('tradeProposed', function(tradeId, steamId) { 
	winston.info("Trade from " + steamId + " proposed, ID " + tradeId);

	if (_.contains(secrets.blacklist, steamId)) {
		winston.info("Blocked user " + steamId);
		bot.respondToTrade(tradeId, false);
	}
	else if (!canTrade) {
		winston.info("Can't trade");
		bot.sendMessage(steamId, notReadyMessage);
		bot.respondToTrade(tradeId, false);
	}
	else if (paused && steamId != secrets.ownerId) {
		winston.info("Paused");
		bot.sendMessage(steamId, pausedMessage);
		bot.respondToTrade(tradeId, false);
	}
	else {
		winston.info("Responding to trade");
		bot.respondToTrade(tradeId, true);
	}
});

bot.on('webSessionID', function(sessionId) {
	winston.info("Got webSessionID " + sessionId);
	webSessionId = sessionId;

	bot.webLogOn(function(newCookies) {
		winston.info("webLogOn returned " + newCookies);
		cookies = newCookies;

		if (!paused) {
			bot.setPersonaState(steam.EPersonaState.LookingToTrade);
		}

		canTrade = true;
		winston.info("cookies/session set up");
	});
});

bot.on('sessionStart', function(steamId) {
	winston.info("sessionStart " + steamId);
	if (!canTrade) {
		winston.info("Not ready to trade with " + steamId);
		bot.sendMessage(steamId, notReadyMessage);
	}
	else {

		var steamTrade = new SteamTrade();
		steamTrade.sessionID = webSessionId;
		_.each(cookies, function(cookie) {  
			winston.info("setting cookie " + cookie);
			steamTrade.setCookie(cookie);
		});

		steamTrade.open(steamId, function() {
			if (!paused) {
				bot.setPersonaState(steam.EPersonaState.Busy);
			}

			winston.info("steamTrade opened with " + steamId);
			steamTrade.chatMsg(sendInstructions1, function() {
			steamTrade.chatMsg(sendInstructions2, function() {
			steamTrade.chatMsg(takeInstructions1, function() {
			steamTrade.chatMsg(takeInstructions2, function() {
			steamTrade.chatMsg(takeInstructions3, function() {
			steamTrade.chatMsg(takeInstructions4, function() {
				winston.info("Instruction messages sent to " + steamId);

				steamTrade.on('ready', function() {
					winston.info("User is ready to trade " + steamId);
					readyUp(steamTrade, steamId);
				});

				steamTrade.on('chatMsg', function(message) {
					winston.info("chatMsg from " + steamId, message);
					if (message.indexOf('http://steamcommunity.com/id/' + secrets.profileId + '/inventory') != 0) {
						winston.info("Bad link");
						steamTrade.chatMsg(badLinkMessage);
					}
					else if (message == 'http://steamcommunity.com/id/'  + secrets.profileId +  '/inventory/') {
						winston.info("Wrong link");
						steamTrade.chatMsg(wrongLinkMessage, function() {
						steamTrade.chatMsg(takeInstructions1, function() {
						steamTrade.chatMsg(takeInstructions2, function() {
						steamTrade.chatMsg(takeInstructions3, function() {
						steamTrade.chatMsg(takeInstructions4) }) }) }) }); 
					}
					else {
						parseInventoryLink(steamTrade, message, function(item) {
							if (!item) {
								winston.info("No item retuned");
								steamTrade.chatMsg(itemNotFoundMessage);
							}
							else {
								steamTrade.addItems([item], function(res) {
									if (!res || res.length < 1 || res[0].error) {
										steamTrade.chatMsg(cantAddMessage);
									}
									else {
										steamTrade.chatMsg(addedMessage);
									}
								});
							}
						});
					}
				});

				steamTrade.on('end', function(status, getItems) {
					winston.info("Trade ended with status " + status);
					if (!paused) {
						bot.setPersonaState(steam.EPersonaState.LookingToTrade);
					}
					if (status == 'complete') {
						bot.sendMessage(steamId, tradeCompleteMessage);
					}
				});
			});
			});
			});
			});
			});
			});
		});
	}
});

bot.on('tradeOffers', function(numOffers) {
	winston.info("tradeOffers event", arguments);

	if (numOffers <= 0) {
		return;
	}

	if (!canTrade) {
		winston.info("Can't accept trade offers yet");
		return;
	}
	
	// Wait a few seconds before responding
	setTimeout(function() { acceptAllTradeOffers(); }, 10000);
});

var parseInventoryLink = function(steamTrade, message, callback) {
	var prefix = 'http://steamcommunity.com/id/' + secrets.profileId + '/inventory/#';
	if (message.indexOf(prefix) != 0) {
		prefix = 'http://steamcommunity.com/id/' + secrets.profileId + '/inventory#';
	}

	if (message.indexOf(prefix) != 0) {	
		return callback();
	}

	else {
		var itemDetails = message.substring(prefix.length);
		winston.info("Parsed item details " + itemDetails);
		if (!itemDetails) {
			return callback();
		}

		var splitDetails = itemDetails.split("_");
		winston.info("Split item details", splitDetails);
		if (splitDetails.length != 3) {
			return callback();
		}

		var appId = splitDetails[0];
		var contextId = splitDetails[1];

		steamTrade.loadInventory(appId, contextId, function(items) {
			if (!items) {
				return callback();
			}
			else {
				var result = null;
				_.each(items, function(item) {
					if (item.id == splitDetails[2]) {
						result = item;
					}
				});
				return callback(result);
			}
		});
	}
};

var readyUp = function(steamTrade, steamId) {
	steamTrade.ready(function() {
		winston.info("Set my offerings as ready with " + steamId);
		steamTrade.confirm(function() {
			winston.info("Confirmed trade with " + steamId);
		});
	});
}

var getInventoryHistory = function() {
	var jar = cookieJar();
	var results = [];	

	requestHistoryPage(1, jar, results, function() {
		fs.writeFileSync('trades.csv', '"Trade ID","Date","Time","Encrypted User","Direction","Item"\n');

		_.each(results, function(historyItem) {
			winston.info("historyItem", historyItem);
			fs.appendFileSync('trades.csv', formatHistoryItem(historyItem));
		});
	});
};

var formatHistoryItem = function(historyItem) {
	var hmac = crypto.createHmac("sha1", secrets.hmacSecret);
	hmac.update(historyItem.user);
	encryptedUser = hmac.digest("hex");

	var row = '"' + historyItem.tradeId + '",';
	row += '"' + historyItem.date + '",';
	row += '"' + historyItem.time + '",';
	row += '"' + encryptedUser + '",';
	row += '"' + historyItem.type + '",';
	row += '"' + historyItem.item + '"\n';

	return row;
};

var requestHistoryPage = function(pageNum, jar, results, callback) {
	var url = 'http://steamcommunity.com/id/' + secrets.profileId + '/inventoryhistory/?p=' + pageNum;
	winston.info("requesting page " + url);
	request({ url: url, jar: jar }, function (error, response, body) {
		if (error) {
			winston.error("request error", error);
		}
		else {
			$ = cheerio.load(body);

			var lastPage = true;
			$('.pagebtn').each(function(i, elem) {
				var $elem = $(elem);
				if ($elem.text() == '>' && !$elem.hasClass('disabled')) {
					lastPage = false;
				}
			});

			$('.tradehistoryrow').each(function(i, elem) {
				winston.info("processing row");
				var date = $(elem).find('.tradehistory_date').text();
				var time = $(elem).find('.tradehistory_timestamp').text();
				var user = $(elem).find('.tradehistory_event_description a').attr('href');
				var tradeId = uuid.v4();

				$(elem).find('.tradehistory_items_received .history_item .history_item_name').each(function(i, itemElem) {
					results.push({ tradeId: tradeId, date: date, time: time, user: user, type: 'Received', item: $(itemElem).text() });
				});
				$(elem).find('.tradehistory_items_given .history_item .history_item_name').each(function(i, itemElem) {
					results.push({ tradeId: tradeId, date: date, time: time, user: user, type: 'Given', item: $(itemElem).text() });
				});
			});


			if (lastPage) {
				winston.info('got to last page');
				return callback();
			}
			else {
				requestHistoryPage(pageNum + 1, jar, results, callback);
			}
		}
	});
};

// NOTE: this doesn't yet block trade offers from people on the blacklist
//TODO fix this if I ever block anyone
var acceptAllTradeOffers = function() {

	if (paused) {
		winston.info("Paused, can't accept trade offers");
		return;
	}


	if (respondingToTradeRequests) {
		winston.info("Already responding to trade offers");
		return;
	}

	respondingToTradeRequests = true;

	var jar = cookieJar();
	var url = 'http://steamcommunity.com/id/' + secrets.profileId + '/tradeoffers/';
	winston.info("requesting page " + url);

	request({ url: url, jar: jar }, function (error, response, body) {
		if (error) {
			winston.error("tradeoffers request error", error);
			respondingToTradeRequests = false;
			return;
		}

		$ = cheerio.load(body);

		var tradeIds = [];
		$('.tradeoffer').each(function(i, elem) {
			var $elem = $(elem);

			var active = $elem.find('.tradeoffer_footer_actions').length > 0;
			var id = $elem.attr('id');

			// Use report flag to find ID of user who sent request
			// E.g. javascript:ReportTradeScam( '76561198099219762', "TrashBot" );
			var reportLink = $elem.find('a.btn_report').attr('href');
			var offererId = findSteamIdInReportLink(reportLink) ;

			winston.info("Found " + (active ? "active" : "inactive") + " trade request from " + offererId + " with ID:" , id);

			if (active && !_.contains(secrets.blacklist, offererId)) {
				var tradeId = id.replace('tradeofferid_', '');
				if (tradeId) {
					tradeIds.push(tradeId);
				}
			}
		});

		async.eachSeries(tradeIds, acceptTradeOffer, function(err) { 
			winston.info("Finished accepting trade offers with err", err)
			respondingToTradeRequests = false; 
		});
	});
};

// Regular posts to accept trade offers are 403 forbidden, so use PhantomJS to accept them through the Steam website
var acceptTradeOffer = function(tradeId, callback) {
	winston.info("Accepting tradeId", tradeId);

	try {
		phantom.create(function(err,ph) {
			_.each(cookies, function(cookieStr) {
				var cookieDetails = splitCookie(cookieStr);
				ph.addCookie({
					'name': cookieDetails.name,
					'value': cookieDetails.value,
					'domain': 'steamcommunity.com',
					'httponly': true,
					'secure': false,
					'expires': (new Date()).getTime() + (1000 * 60 * 60)
				});
			});

			return ph.createPage(function(err,page) {
				if (err) {
					winston.error("Phantom create error", err);
					return callback(err);
				}

				return page.open('http://steamcommunity.com/tradeoffer/' + tradeId + '/', function(err, status) {
					if (err) {
						winston.error("Phantom open error", err);
						return callback(err);
					}
					winston.info("Opened trade offer site", status);

					return page.evaluate(function() {
						var done = false;
						
						// Need to wait a while after clicking buttons
						setTimeout(function() {
							// $ is a non-jQuery library on the steam site
							$J('#you_notready').click();
							setTimeout(function() {
								// "Yes this is a gift" button
								giftButton = $J('.newmodal .btn_green_white_innerfade');
								if (giftButton && giftButton.length > 0) {
									giftButton.click();
								}
								setTimeout(function() {
									$J('#trade_confirmbtn').click();
									done = true;
								}, 5000);
							}, 5000);
						}, 5000);

						while (!done) {
							// force wait
						}

						return { ok: true };
					}, 
					function(err, result) {
						if (err) {
							winston.error("Phantom evaluate error", err);
							return callback(err);
						}
						winston.info("Accepted trade", tradeId);
						ph.exit();
						return callback(null);
					});
				});
			});
		});
	}
	catch(err) {
		winston.error("Phantom exception: ", err);
	}
};

var removeAllFriends = function() {
	_.each(bot.friends, function(relationship, friendId) {
		if (relationship == steam.EFriendRelationship.Friend 
			&& !_.contains(secrets.whitelist, friendId) && friendId != secrets.ownerId) {

			winston.info("Removing friend with ID " + friendId);
			bot.removeFriend(friendId);
		}
	});
};

var addPendingFriends = function() {
	_.each(bot.friends, function(relationship, friendId) {
		if (relationship == steam.EFriendRelationship.RequestInitiator && !_.contains(secrets.blacklist, steamId)) {
			winston.info("Adding friend with ID " + friendId);
			bot.addFriend(friendId);
		}
	});
};

var splitCookie = function(cookieStr) {
	var index = cookieStr.indexOf("=");
	var name = cookieStr.substr(0,index);
	var value = cookieStr.substr(index+1);
	return { name: name, value: value };
};

var cookieJar = function() {
	var jar = request.jar();
	_.each(cookies, function(cookieStr) {
		winston.info("adding cookie to jar", cookieStr);
		var reqCookie = request.cookie(cookieStr);
		jar.add(reqCookie);
	});
	return jar;
};

var findSteamIdInReportLink = function(reportLink) {
	var re = /javascript:ReportTradeScam\(\s*'(\d+)'/;
	var match = reportLink.match(re);
	return match && match.length > 0 ? match[1] : undefined;
};