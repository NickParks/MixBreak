const CURRENT_VERSION_TAG = "1.0";

const { ShortCodeExpireError, OAuthClient } = require('@mixer/shortcode-oauth');
const rp = require('request-promise');
const fs = require('fs');
const opn = require('opn');

const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const oAuthClient = new OAuthClient({
    clientId: 'ab921d1ce86409bf9fea2c76d0691afc75465dbc7e719d60',
    scopes: ['chat:ad_break'],
});

var token;
var refreshToken;

//Config values
var config = {
    cycle_time: 60 //Default to 60 until read into config
};

//Our main function
async function start() {
    const getCurrentUser = await rp('https://mixer.com/api/v1/users/current', {
        headers: {
            'Authorization': 'Bearer ' + token
        },
        json: true
    });

    currentUserId = getCurrentUser.id;
    currentChannelName = getCurrentUser.channel.token;
    currentChannelId = getCurrentUser.channel.id;

    setInterval(() => {
        runAd();
    }, 1000 * 60 * config.cycle_time); //Cycle time in minutes

    setInterval(() => {
        getNewTokensFromRefresh(false);
    }, 1000 * 60 * 60 * 5); //Expiry time for token
}

//Sends the post request to play an ad
function runAd() {
    rp.post(`https://mixer.com/api/v2/ads/cahnnels/${currentChannelId}`, {
        headers: {
            'User-Agent': 'MixBreak',
            'Authorization': 'Bearer ' + token
        },
        json: true
    }).then((result) => {
        console.log(result);
    }).catch((err) => {
        console.error(err);
    });
}

//Get OAuth
function startAttempts() {
    attempt().then(tokens => {
        token = tokens.data.accessToken;
        refreshToken = tokens.data.refreshToken;

        //Write our new tokens to file
        fs.writeFile("./data/authTokens.json", JSON.stringify(tokens.data), (err) => {
            if (err) {
                console.error("Failed to write new tokens to file..");
            }

            console.log("MixBreak is ready to go! ADs will start running every " + config.cycle_time + " minutes!");

            start();
        });
    });
}

//Literally ripped from the example
const attempt = () =>
    oAuthClient
        .getCode()
        .then(code => {
            console.log("Please accept the authentication window that should be open in your browser");
            opn(`https://mixer.com/go?code=${code.code}`);
            return code.waitForAccept();
        })
        .catch(err => {
            if (err instanceof ShortCodeExpireError) {
                return attempt(); // loop!
            }

            throw err;
        });

//Refresh token
function getNewTokensFromRefresh(startAfter) {
    let queryString = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "ab921d1ce86409bf9fea2c76d0691afc75465dbc7e719d60"
    }

    rp.post('https://mixer.com/api/v1/oauth/token', {
        body: queryString,
        json: true
    }).then((result) => {
        token = result.access_token;
        refreshToken = result.refresh_token;

        let tokensToWrite = {
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            expires_in: result.expires_in
        }

        //Write our new tokens to file
        fs.writeFile("./data/authTokens.json", JSON.stringify(tokensToWrite), (err) => {
            if (err) {
                console.error("Failed to write new tokens to file..");
            }

            if (startAfter) {
                start();
            }
        });
    }).catch(err => {
        console.log("Failed to get new tokens");
    });
}

//Ran when no config is found
function runFirstStart() {
    console.log("Welcome to MixBreak! Automagically running ADs for you on Mixer!");
    console.log("Please answer the following for your configuration: ");

    rl.question("How often do you want to run an ad (in minutes)?", function (answer) {
        if (isNaN(answer)) {
            console.log("You entered an invalid number, so we're defaulting it to 1 hour!");
            config.cycle_time = 60;
        } else {
            if (config.cycle_time > 15) {
                cycle_time = 15;
                console.log("Mixer only allows one ad every 15 minutes. Defaulting to 15.");
            }
        }

        fs.writeFileSync('./data/config.json', JSON.stringify(config));

        rl.close();
    });

    rl.on("close", function () {
        console.log("Booting up MixBreak now!");

        //Get auth now that we've setup the config
        startAttempts();
    });
}

//Startup script
if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
}

if (!fs.existsSync('./data/config.json')) {
    //No config - run first config
    runFirstStart();
} else {
    //We have a config - lets run auth
    if (!fs.existsSync("./data/authTokens.json")) {
        //No auth found
        fs.writeFile("./data/authTokens.json", JSON.stringify({}), (err) => {
            if (err) {
                console.error("Could not write data to file to save auth tokens...");
            }

            startAttempts();
        });
    } else {
        //Exists so try to read it
        fs.readFile("./data/authTokens.json", (error, data) => {
            if (error) {
                console.error("Error reading file, please re-auth");
                startAttempts();
                return;
            }

            let parsed = JSON.parse(data);

            if (parsed.accessToken != undefined) {
                //Set tokens
                token = parsed.accessToken;
                refreshToken = parsed.refreshToken;

                //Get new ones
                getNewTokensFromRefresh(true);

                return;
            } else {
                startAttempts();
            }
        });
    }
}

//Version checker
rp('https://api.github.com/repos/NickParks/MixBreak/releases/latest', {
    headers: {
        'User-Agent': "MixBreak"
    },
    json: true
}).then((value) => {
    if (value.tag_name != CURRENT_VERSION_TAG) {
        console.log('\x1b[36m%s\x1b[0m', "There is a new version available for download!");
        console.log('\x1b[36m%s\x1b[0m', value.url);
    }
}).catch(err => {
    //Error getting github
    console.log("Failed to check for updates");
});