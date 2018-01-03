node-steam-trash-bot
====================

# Deprecation note

This is no longer maintained and probably doesn't work anymore due to Steam's updated fraud protection methods.

# Original readme

This is a Steam bot that will automatically accept friend requests, and will take any trash out of other peoples inventory, or give anything from it's own inventory. To send trash to it, sent a trade request and put anything up for trade, the bot will accept anything. To get anything out of its inventory, start a trade request and paste a link to the item. The bot should hopefully be up and running [here](http://steamcommunity.com/id/trashbot). All trade offers are also automatically accepted. This code is a bit of spaghetti but it was something I just wanted to get working and it gets the job done. If you want to get your own copy running you'll need a file called secrets.js that contains the following:

	exports.secrets = {
		username: 'username',
		password: 'password',
		guardCode: 'code from email after unsuccessful login attempt',
		profileId: 'ID part of the profile URL e.g. trashbot for http://steamcommunity.com/id/trashbot/inventory/',
		ownerId: 'numerical steam ID of the person who can control the bot'
		blacklist: ['steam ID of user to block', 'another steam ID to block'],
		whitelist: ['steam ID of user to keep as a friend', 'another steam ID of user to keep as a friend'],
		hmacSecret: 'random string used to encode usernames during export',
		environment: 'windows or linux, used to control how to spawn the CasperJS trade offer accepting process',
		mongoUpdaterPort: 3001, // Port to use for the mongo stat update server
		mongoUri: 'mongodb://u:p@address:port/database' // Mongo URI to use when storing stats
	};

The bot will need to have Steam Guard enabled for 15 days before it will be able to respond to trade requests, and it may also need to own a game. Also to accept "offline" trade offers, [PhantomJS](http://phantomjs.org/) and [CasperJS](http://casperjs.org/) must be installed and set up. The bot will automatically remove newly added friends after a while unless that user is the owner or on the whitelist.

Run the mongo-updater.js server to store historical trade details in MongoDB, if this isn't running you should get rid of the code that calls the server so there is no time wasted while waiting for the requests to fail.

First time setup:
* Create an account and turn Steam Guard on
* Set all config and leave guardCode set to null
* Try to run bot.js, you'll get a login error and a guard code will be emailed to you
* Set guardCode to the code that's sent you and run bot.js again
* Try to trade with the bot, make both a trade offer and a trade request
* These will fail but will start the 15 day countdown, so everything should start working 15 days later
