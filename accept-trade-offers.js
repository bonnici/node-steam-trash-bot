var fs = require('fs');
var utils = require('utils');
var secrets = require('./secrets.js').secrets;

var cookieFile = 'cookies';
var numCaptures = 0;

var cookieStr = fs.read(cookieFile);
var cookies = cookieStr.split('; ');

var requestWait = 5000;
var shouldCapture = false;

var casper = require('casper').create();
//var casper = require('casper').create({
//	verbose: true,
//	logLevel: "debug"
//});

casper.on('remote.message', function(message) {
	console.log(message);
});

/*
casper.start();

casper.thenOpen('http://localhost:3001/user/asd/added', {
	method: 'post',
	data: {}
}, function(param) {
	if (param.status == 204) {
		console.log("added");
	} else {
		console.log("added call failed");
	}
});

casper.thenOpen('http://localhost:3001/user/asd/removed', {
	method: 'post',
	data: {}
}, function(param) {
	if (param.status == 204) {
		console.log("removed");
	} else {
		console.log("removed call failed");
	}
});

casper.thenOpen('http://localhost:3001/user/asd', {
	method: 'get',
	data: {}
}, function(param) {
	if (param.status == 200) {
		var content = this.getPageContent();
		console.log("user content", content);
		try {
			var obj = JSON.parse(content);
			console.log("obj", obj);
			console.log("obj.numTimesAdded", obj.numTimesAdded);
			if (obj.isBlacklisted) {
				console.log("user is blacklisted");
			} else {
				console.log("user is NOT blacklisted");
			}
		} catch (e) {
			console.log("exception parsing json", e);
		}
	} else {
		console.log("user call failed");
	}
});
*/

for (var i=0; i < cookies.length; i++) {
	var cookieDetails = cookies[i].split("=");

	phantom.addCookie({
		'name': cookieDetails[0],
		'value': cookieDetails[1],
		'domain': 'steamcommunity.com',
		'httponly': true,
		'secure': false,
		'expires': (new Date()).getTime() + (1000 * 60 * 60)
	});
}

casper.start('http://steamcommunity.com/', function() {
	if (shouldCapture) { this.capture((++numCaptures) + '-homepage.png'); }

	var offerUrl = this.evaluate(function() {
		return document.querySelector('a.header_notification_tradeoffers').getAttribute('href');
	});

	this.thenOpen(offerUrl, function() {
		console.log('Opened trade offer page');
		console.log(this.getCurrentUrl());
		if (shouldCapture) { this.capture((++numCaptures) + '-opened-offers.png'); }
	});
});

function getTradeOfferIds(blacklist) {
	var offers = document.querySelectorAll('div.tradeoffer');
	console.log("Found " + offers.length + " trade offers");

	var findSteamIdInReportLink = function(reportLink) {
		var re = /javascript:ReportTradeScam\(\s*'(\d+)'/;
		var match = reportLink.match(re);
		return match && match.length > 0 ? match[1] : undefined;
	};

	var offerIds = [];
	for (var i=0; i < offers.length; i++) {
		var div = offers[i];

		var id = div.getAttribute('id');
		var offerId = id.replace('tradeofferid_', '');
		var active = div.querySelectorAll('div.inactive').length == 0;

		var reportLink = div.querySelectorAll('a.btn_report')[0].getAttribute('href');
		var offererId = findSteamIdInReportLink(reportLink);

		console.log("Found " + (active ? "active" : "inactive") + " trade request from " + offererId + " with ID:" + offerId);

		var onBlacklist = false;
		for (var j=0; j < blacklist.length; j++) {
			if (offererId == blacklist[j]) {
				onBlacklist = true;
			}
		}
		if (active && offerId && !onBlacklist) {
			offerIds.push(offerId);
		}
	}
	return offerIds;
}



casper.then(function() {
	var offerIds = this.evaluate(getTradeOfferIds, secrets.blacklist);
	console.log('offerIds');
	console.log(offerIds);

	for (var i=0; i < offerIds.length; i++) {
		this.thenOpen('http://steamcommunity.com/tradeoffer/' + offerIds[i] + '/', function() {
			console.log('Opened trade offer page:');
			console.log(this.getCurrentUrl());
			if (shouldCapture) { this.capture((++numCaptures) + '-offer.png'); }

			this.evaluate(function() {
				// $ is a non-jQuery library on the steam site
				$J('#you_notready').click();
				console.log('clicked ready');
			});		
			if (shouldCapture) { this.capture((++numCaptures) + '-clickedready.png'); }

			this.wait(requestWait, function() {

				this.evaluate(function() {
					// "Yes this is a gift" button
					giftButton = $J('.newmodal .btn_green_white_innerfade');
					if (giftButton && giftButton.length > 0) {
						giftButton.click();
						console.log('clicked gift acceptance');
					}
				});
				if (shouldCapture) { this.capture((++numCaptures) + '-checkedgift.png'); }

				this.wait(requestWait, function() {
					var itemDetails = this.evaluate(function() {

						var myGetNameForItem = function(idString, fromMyInventory) {
							if (!idString || !g_rgAppContextData) return null;

							var splitId = idString.split("_");
							if (splitId.length != 3) return;

							var appId = splitId[0];
							var contextId = splitId[1];
							var invId = splitId[2];

							var contextData = fromMyInventory ? g_rgAppContextData : g_rgPartnerAppContextData;

							try {
								return contextData[appId].rgContexts[contextId].inventory.rgInventory[invId].name;
							} catch (e) {
								return null;
							}
						}

						var findItemIds = function(prefix, fromMyInventory) {
							var results = [];
							$J('#' + prefix + ' .item').each(function() {
								var paddedId = $J(this).attr("id");
								if (paddedId && paddedId.length > 4) {
									// ID is of the form "item753_6_1071908636"
									var strippedId = paddedId.substr(4);
									var itemDetails = { id: strippedId };
									var name = myGetNameForItem(strippedId, fromMyInventory);
									if (name) {
										itemDetails.name = name;
									}

									results.push(itemDetails);
								}
							});
							return results;
						};

						var buildItemDetails = function(userId, tradeId, item, wasClaimed) {
							var details = {
								userId: g_ulTradePartnerSteamID,
								tradeId: tradeId,
								itemId: item.id,
								wasClaimed: wasClaimed
							};
							if (item.name) {
								details.name = item.name;
							}
							return details;
						}

						var userId = g_ulTradePartnerSteamID;

						// generate random GUID for trade ID
						// http://stackoverflow.com/a/8809472/20925
						var d = new Date().getTime();
						var tradeId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
							var r = (d + Math.random()*16)%16 | 0;
							d = Math.floor(d/16);
							return (c=='x' ? r : (r&0x7|0x8)).toString(16);
						});

						var claimedItems = findItemIds('trade_yours', true);
						var donatedItems = findItemIds('trade_theirs', false);

						var itemDetails = [];
						for (var i = 0; i < claimedItems.length; i++) {
							itemDetails.push(buildItemDetails(userId, tradeId, claimedItems[i], true));
						}
						for (var i = 0; i < donatedItems.length; i++) {
							itemDetails.push(buildItemDetails(userId, tradeId, donatedItems[i], false));
						}

						$J('#trade_confirmbtn').click();
						console.log('clicked confirm');

						return itemDetails;
					});
					if (shouldCapture) { this.capture((++numCaptures) + '-clickedconfirm.png'); }

					this.wait(requestWait, function() {
						console.log('done, logging results');
						if (shouldCapture) { this.capture((++numCaptures) + '-finishedtrade.png'); }

						// If the trade succeeded we should be redirected to the receipt page
						var url = this.getCurrentUrl();
						var suffix = "/receipt";
						var tradeSucceeded = url.indexOf(suffix, url.length - suffix.length) !== -1;

						if (tradeSucceeded && itemDetails && itemDetails.length > 0) {
							var mongoUpdaterUrl = "http://localhost:" + secrets.mongoUpdaterPort;

							this.thenOpen(mongoUpdaterUrl + "/user/" + itemDetails[0].userId + "/trade-accepted" , {
								method: 'post',
								data: {}
							}, function(param) {
								if (param.status != 204) {
									console.log("Posting trade accepted to mongo failed");
								}
							});

							for (var i = 0; i < itemDetails.length; i++) {
								var postUrl = mongoUpdaterUrl + "/trade/" + itemDetails[i].userId + "/" 
									+ itemDetails[i].tradeId + "/" + itemDetails[i].itemId + "/" + itemDetails[i].wasClaimed;
								var body = {};
								if (itemDetails[i].name) {
									body.name = itemDetails[i].name;
								}

								this.thenOpen(postUrl , {
									method: 'post',
									headers: { 'Content-Type': 'application/json' },
									data: JSON.stringify(body)
								}, function(param) {
									if (param.status != 204) {
										console.log("Posting item details to mongo failed");
									}
								});
							}
						}
					});
				});
			});
		});
	}
});

casper.run();