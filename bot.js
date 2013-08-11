var fs = require('fs');
var steam = require('steam');
var SteamTrade = require('steam-trade');
var winston = require('winston');
var _ = require('underscore');

var secrets = require('./secrets.js').secrets;

var serversFile = 'servers';
var sentryFile = 'sentry';
var webSessionId = null;
var steamTrade = null;
var canTrade = false;

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

// Auto-accept friends
bot.on('friend', function(userId, relationship) { 
	winston.info("friend event for " + userId + " type " + relationship);
	if (relationship == steam.EFriendRelationship.PendingInvitee) {
		winston.info("added " + userId + " as a friend");
		bot.addFriend(userId);
		setTimeout(function() {
			bot.sendMessage(userId, "Hello! To give me your trash or get something from my inventory, invite me to trade and I'll give you instructions there. \
Please remember to remove me from your friends list after you are done so that other people can trade with me. \
If you want to make trades later you can always re-add me.");
		}, 5000);
	}
});

bot.on('friendMsg', function(userId, message, entryType) { 
	if (entryType == steam.EChatEntryType.ChatMsg) {
		bot.sendMessage(userId, "Hello! To give me your trash or get something from my inventory, invite me to trade and I'll give you instructions there.");
	}
});

bot.on('tradeProposed', function(tradeId, steamId) { 
	winston.info("Trade from " + steamId + " proposed, ID " + tradeId);
	bot.respondToTrade(tradeId, true);
});

bot.on('webSessionID', function(sessionId) {
	winston.info("Got webSessionID " + sessionId);
	webSessionId = sessionId;

	bot.webLogOn(function(cookies) {
		winston.info("webLogOn returned " + cookies);
		steamTrade = new SteamTrade();
		steamTrade.sessionID = webSessionId;
		_.each(cookies, function(cookie) {  
			winston.info("setting cookie " + cookie);
			steamTrade.setCookie(cookie);
		});

		bot.setPersonaState(steam.EPersonaState.LookingToTrade);

		canTrade = true;
		winston.info("steamTrade set up", steamTrade);
	});
});

var sendInstructions = "If you want to give me something, offer it for trade then check ready and I'll check ready soon after. \
Click Make Trade when you're sure you want to send me your items.";
var takeInstructions = 'If you want me to send you something from my inventory, go to my inventory (http://steamcommunity.com/id/trashbot/inventory/), \
right click on what you want and select "Copy Link Address", then paste that into this trade chat window and I\'ll add the item. Check ready then click Make Trade when you\'re happy with the offerings.';
var tradeCompleteMessage = "Trade complete! Please remember to remove me from your friends list if you don't want to make any more trades so that other \
people can trade with me. If you want to make trades later you can always re-add me.";
var wrongLinkMessage = 'It looks like you selected "Copy Page URL", you need to select "Copy Link Address"';
var badLinkMessage = 'I don\'t recognise that link. ' + takeInstructions;
var itemNotFoundMessage = 'It looks like I don\'t have that item anymore, you may need to refresh my inventory page';

var parseInventoryLink = function(message, callback) {
	var prefix = 'http://steamcommunity.com/id/trashbot/inventory/#';
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

var readyUp = function(steamId) {
	steamTrade.ready(function() {
		winston.info("Set my offerings as ready with " + steamId);
		steamTrade.confirm(function() {
			winston.info("Confirmed trade with " + steamId);
		});
	});
}

bot.on('sessionStart', function(steamId) {
	winston.info("sessionStart " + steamId);
	if (!canTrade || !steamTrade) {
		winston.info("Not ready to trade with " + steamId);
		bot.sendMessage(steamId, "Sorry, I can't accept a trade request right now, wait a few minutes and try again.")
	}
	else {
		steamTrade.open(steamId, function() {
			winston.info("steamTrade opened with " + steamId);
			steamTrade.chatMsg(sendInstructions, function() {
				steamTrade.chatMsg(takeInstructions, function() {
					winston.info("Instruction messages sent to " + steamId);

					steamTrade.on('ready', function() {
						winston.info("User is ready to trade " + steamId);
						readyUp(steamId);
					});

					steamTrade.on('chatMsg', function(message) {
						winston.info("chatMsg from " + steamId, message);
						if (message.indexOf('http://steamcommunity.com/id/trashbot/inventory/') != 0) {
							steamTrade.chatMsg(badLinkMessage);
						}
						else if (message == 'http://steamcommunity.com/id/trashbot/inventory/') {
							steamTrade.chatMsg(wrongLinkMessage);
						}
						else {
							parseInventoryLink(message, function(item) {
								if (!item) {
									steamTrade.chatMsg(itemNotFoundMessage);
								}
								else {
									steamTrade.addItems([item], function() {
										readyUp(steamId);
									});
								}
							});
						}
					});

					steamTrade.on('end', function(status, getItems) {
						if (status == 'complete') {
							bot.sendMessage(steamId, tradeCompleteMessage);
						}
					});
				});
			});
		});
	}
});

bot.on('servers', function(servers) {
	fs.writeFile(serversFile, JSON.stringify(servers));
});