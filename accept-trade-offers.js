var fs = require('fs');
var utils = require('utils');
var secrets = require('./secrets.js').secrets;

var cookieFile = 'cookies';
var numCaptures = 0;

var cookieStr = fs.read(cookieFile);
var cookies = cookieStr.split('; ');

var casper = require('casper').create();
//var casper = require('casper').create({
//	verbose: true,
//	logLevel: "debug"
//});

casper.on('remote.message', function(message) {
    console.log(message);
});

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
	//this.capture((++numCaptures) + '-homepage.png');

	var offerUrl = this.evaluate(function() {
		return document.querySelector('a.header_notification_tradeoffers').getAttribute('href');
	});

	this.thenOpen(offerUrl, function() {
		console.log('Opened trade offer page');
		console.log(this.getCurrentUrl());
		//this.capture((++numCaptures) + '-opened-offers.png');
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
			//this.capture((++numCaptures) + '-offer.png');

			this.evaluate(function() {
				// $ is a non-jQuery library on the steam site
				$J('#you_notready').click();
				console.log('clicked ready');
			});		
			//this.capture((++numCaptures) + '-clickedready.png');

			this.wait(5000, function() {
				this.evaluate(function() {
					// "Yes this is a gift" button
					giftButton = $J('.newmodal .btn_green_white_innerfade');
					if (giftButton && giftButton.length > 0) {
						giftButton.click();
						console.log('clicked gift acceptance');
					}
				});
				//this.capture((++numCaptures) + '-checkedgift.png');

				this.wait(5000, function() {
					this.evaluate(function() {
						$J('#trade_confirmbtn').click();
						console.log('clicked confirm');
					});
					//this.capture((++numCaptures) + '-clickedconfirm.png');

					this.wait(5000, function() {});
					//this.capture((++numCaptures) + '-finishedtrade.png');
				});
			});
		});
    }
});

casper.run();