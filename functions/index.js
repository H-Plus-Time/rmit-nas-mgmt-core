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
        const subject = 'Invitation to RMIT Food Deals';
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

// listen to DB write events
exports.fireNotification = functions.database.ref('/offers/{rid}/{arrId}').onWrite(event => {
    // grab new value of what was added
    const newFeed = event.data.val(); // feed -> the object
    // check for error or deletion
    if (newFeed === null) {
        return Promise.resolve();
    }
    let rid = event.params.rid;
    // Notification info
    const payload = {
        notification: {
            title: `Latest Deal: ${newFeed.title}`,
            body: newFeed.tagline,
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
const qrcodeToFile = promisify(qrcode.toFile);
exports.autoShorten = functions.database.ref('retailers/{rid}').onWrite(event => {
    let rid = event.params.rid;
    if (event.data.previous.exists()) {
        return;
    }
    googl.setKey(conf.googlKey);

    // Get currently set developer key
    googl.getKey();
    // create the could URL!
    googl.shorten(`http://nas-app.firebaseapp.com/?${rid}`)
    .then(function (shortUrl) {
        console.log(shortUrl);
        // non-functional for the moment
        // qrcodeToFile('./tmp.png', shortUrl, opts).then(err => {
        //     // don't care
        //     return fsRead('./tmp.png')
        // }).then(buffer => {
        //     return admin.storage().ref('qrcodes').child(shortUrl).put(buffer)
        // })
        return admin.database().ref(`retailers/${rid}/url`).set(shortUrl);
    })
    .then(resp => {
        console.log("Successfully saved shortUrl")
    })
    .catch(function (err) {
        console.error(err.message);
    });
})
