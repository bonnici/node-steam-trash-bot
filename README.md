node-steam-trash-bot
====================

This is a Steam bot that will automatically accept friend requests, and will take any trash out of other peoples inventory, or give anything from it's own inventory. To send trash to it, sent a trade request and put anything up for trade, the bot will accept anything. To get anything out of its inventory, start a trade request and paste a link to the item. The bot should hopefully be up and running [here](http://steamcommunity.com/id/trashbot). This code is a bit of spaghetti but it was something I just wanted to get working and it gets the job done. If you want to get your own copy running you'll need a file called secrets.js that contains the following:

	exports.secrets = {
		username: 'username',
		password: 'password',
		guardCode: 'code from email after unsuccessful login attempt',
		profileId: 'ID part of the profile URL e.g. trashbot for http://steamcommunity.com/id/trashbot/inventory/',
		ownerId: 'numerical steam ID of the person who can control the bot'
		blacklist: ['steam ID of user to block', 'another steam ID to block'],
		hmacSecret: 'random string used to encode usernames during export'
	};

The bot will need to have Steam Guard enabled for 15 days before it will be able to respond to trade requests, and it may also need to own a game. Also to accept "offline" trade offers, [PhantomJS](http://phantomjs.org/) must be installed and set up.