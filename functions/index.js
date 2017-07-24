/**
 * Created by Ryan on 12/05/2017.
 */
const functions = require('firebase-functions');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

//  Following the example on:
// https://github.com/firebase/functions-samples/blob/master/fcm-notifications/functions/index.js
//

const admin = require('firebase-admin');
const readFile = require('fs-readfile-promise');
const dot = require('dot');
const conf = require('./config.js');
admin.initializeApp(functions.config().firebase); // from which Realtime Database changes can be made.
const gcs = require('@google-cloud/storage')();
const bucket = gcs.bucket("nas-app.appspot.com");

exports.dailyCleanup = functions.https.onRequest((request, response) => {
    response.send('Not implemented')
})

exports.notifyInvitee = functions.database.ref('/invitees/{email}').onWrite(event => {
    const email = event.params.email;
    const regularizedEmail = email.replace(/,/g, '.');
    if (event.data.previous.exists()) {
        return;
    }

    readFile('./email_template.html')
    .then(buffer => {
        const helper = require('sendgrid').mail;
        const fromEmail = new helper.Email('nas@rmit.edu.au');
        const toEmail = new helper.Email(regularizedEmail);
        const subject = 'Invitation to RMIT Promos';
        const inviteStr = dot.template(buffer.toString())({email: regularizedEmail});
        const content = new helper.Content('text/html', inviteStr);
        const mail = new helper.Mail(fromEmail, subject, toEmail, content);
        var sg = require('sendgrid')(conf.sendgridKey);
        var request = sg.emptyRequest({
            method: 'POST',
            path: '/v3/mail/send',
            body: mail.toJSON()
        });

        sg.API(request, function (error, response) {
            if (error) {
                console.log('Error response received');
            }
            console.log(response.statusCode);
            console.log(response.body);
            console.log(response.headers);
        });
    })
    
})

const secureCompare = require('secure-compare');

exports.cronFireNotifications = functions.https.onRequest((request, response) => {
    let db = admin.database();
    const key = request.query.key;

    // Exit if the keys don't match
    if (!secureCompare(key, functions.config().cron.key)) {
        console.log('The key provided in the request does not match the key set in the environment. Check that', key,
            'matches the cron.key attribute in `firebase env:get`');
        response.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
            'cron.key environment variable.');
        return;
    }
    db.ref('/offers').once('value', offers => {
        let x = offers.val();
        // probably better to implement this as a promise pool
        Object.keys(x).forEach(rid => {
            Object.keys(x[rid]).forEach(arrId => {
                let entry = x[rid][arrId];
                let now = new Date().getTime() / 1000;
                if(now + 600 > entry.start_time) {
                    // event starts less than 10 minutes from now
                    // send it if it hasn't been sent already
                    if(entry.sent) {
                        return;
                    }
                    db.ref(`/offers/${rid}/${arrId}/sent`).set(now);
                    // Notification info
                    let payload = {
                        notification: {
                            title: entry.title,
                            body: entry.tagline,
                            icon: 'no icon'
                        }
                    };
                    const topicStr = `/topics/offer-${rid}`;
                    // now we have all the information we need. Time to send via the magic of 
                    // PubSub
                    admin.messaging().sendToTopic(topicStr, payload).then(resp => {
                        console.log(resp);
                    }).catch(err => console.log(err));
                }
            })
        })
    }).then(resp => {
        response.send("completed publishing")
    })
})

exports.cleanupStorage = functions.database.ref('/retailers/{rid}/profile/banners/{bannerId}').onWrite(event => {
    if(!event.data.exists()) {
        let path = unescape(URL(event.data.previous.val().src).pathname);
        let relPath = path.split('/').slice(5).join('/');
        // delete the file at path
        return bucket.rm(relPath);
    } else {
        if(event.data.previous.exists() && event.data.val() != event.data.previous.val()) {
            // delete previous
            let path = unescape(URL(event.data.previous.val().src).pathname);
            let relPath = path.split('/').slice(5).join('/');
            return bucket.rm(relPath);
        }
    }
})

// listen to DB write events
exports.fireNotification = functions.database.ref('/offers/{rid}/{arrId}').onWrite(event => {
    // grab new value of what was added
    const newEvent = event.data.val(); // feed -> the object
    // check for error or deletion
    if (newEvent === null) {
        console.log(event.data)
        console.log("data is null")
        // return Promise.resolve();
    }
    if (event.data.previous.exists()) {
        console.log(newEvent)
        console.log(event.data.previous.val())
        console.log("event apparently exists already")
        return;
    }
    let now = new Date().getTime() / 1000;
    if(newEvent.start_time > (now) + 3600) {
        // leave this one for the cron job.
        console.log(`scheduled for ${newEvent.start_time}`)
        return;
    }
    let rid = event.params.rid;
    let arrId = event.params.arrId;

    let db = admin.database();
    db.ref(`/offers/${rid}/${arrId}/sent`).set(now);
    // Notification info
    const payload = {
        notification: {
            title: newEvent.title,
            body: newEvent.tagline,
            icon: 'no icon'
        }
    };
    const topicStr = `/topics/offer-${rid}`;
    // now we have all the information we need. Time to send via the magic of 
    // PubSub
    return admin.messaging().sendToTopic(topicStr, payload).then(resp => {
        console.log(resp);
    }).catch(err => console.log(err));
});
const googl = require('goo.gl');

const promisify = require("es6-promisify");
const qrcode = require('qrcode');
const fsRead = promisify(require('fs').readFile);
const qrcodeToFile = promisify(qrcode.toFile, {multiArgs: true});
const sharp = require('sharp');


exports.autoShorten = functions.database.ref('retailers/{rid}').onWrite(event => {
    let rid = event.params.rid;
    if (event.data.previous.exists()) {
        if(!event.data.exists()) {
            // retailer has been deleted, need to clean up feeds.
            let db = admin.database();
            db.ref(`offers/${rid}`).remove();
            return;
        }
        return;
    }
    const guideMarker = new Buffer(
        '<svg width="768" height="768"><circle cx="384" cy="384" r="300" stroke-width="30" stroke="red" fill-opacity="0"></circle></svg>'
    )
    const options = {
    raw: {
        width: 1024,
        height: 1024,
        channels: 4
    }
    };
    googl.setKey(conf.googlKey);
    googl.getKey();
    // create the short URL!
    googl.shorten(`https://rmit-promos.surge.sh/?${rid}`)
    .then(function (shortUrl) {
        return admin.database().ref(`retailers/${rid}/url`).set(shortUrl).then(resp => {
            return qrcodeToFile('/tmp/temp.png', shortUrl)
        }).then(resp => {
            return sharp(guideMarker).resize(1024, 1024).toFile('/tmp/circle.png');
        }).then(resp => {
            return sharp('/tmp/temp.png').resize(500, 500).raw().toBuffer()
        }).then(resp => {
            return sharp('/tmp/circle.png')
                .overlayWith(resp, {raw: {width:500, height:500, channels:4}})
                .toFile('/tmp/temp2.png')
        }).then(resp => {
            return bucket.upload('/tmp/temp.png', {destination: `qrcodes/${rid}.png`})
        }).then(resp => {
            return bucket.upload('/tmp/temp2.png', {destination: `qrcodes/${rid}-guided.png`})
        })
    })
    .then(resp => {
        console.log("Successfully saved shortUrl")
    })
    .catch(function (err) {
        console.error(err.message);
    });
})
