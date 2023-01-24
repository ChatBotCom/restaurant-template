'use strict';

const TOKEN = '{{YOUR_TOKEN}}'; // put your authorization token here
const FIRESTORE_COLLECTION = 'COLLECTION_NAME'; // put your firestore collection name (https://firebase.google.com/docs/firestore)

const express = require('express');
const { Router } = require('express');
const router = new Router();
const app = express();
const functions = require('firebase-functions');
const firebase = require('firebase-admin');

firebase.initializeApp({
    credential: firebase.credential.applicationDefault()
});

// connect to firestore
const db = admin.firestore().collection(FIRESTORE_COLLECTION);

// function for transform the order to a text message
// docs for the text fullfillment is described here: https://www.chatbot.com/docs/object-definitions
const transformOrderToText = (responses = []) => {
    let text = '';

    if (!responses.length) {
        return 'Your order is empty.';
    }

    responses.map(item => {
        text += `${item.productQuantity}x ${item.productName}\n`;
    });

    return text;
}


// GET for authorization request
router
    .route('/')
    .get((req, res) => {
        if (req.query.token !== TOKEN) {
            return res.sendStatus(401);
        }

        return res.end(req.query.challenge);
    });

// go with request to the proper route based on the action provided in the interaction
router
    .route('/')
    .post((req, res, next) => {
        if (req.query.token !== TOKEN) {
            return res.sendStatus(401);
        }

        req.version = req.body.result ? 1 : 2;

        const action = req.version === 1 ?
            req.body.result.interaction.action : req.body.attributes.action;

        if (['add-product', 'order-summary', 'start-again'].includes(action)) {
            req.url = `/${action}`;
            return next();
        }

        res.json();
    });

// add the product to the order
router
    .route('/add-product')
    .post((req, res, next) => {
        const sessionParameters = req.version === 1 ?
            req.body.result.sessionParameters : req.body.attributes;

        // get attributes collected in the ongoing chat
        const productName = sessionParameters.productName;
        const productQuantity = Number(sessionParameters.productQuantity);

        // make a product object based on the collected attributes
        if (productName && productQuantity) {
            req.product = { productName, productQuantity };

            // go to the next part of request
            return next();
        }

        // return empty response
        return res.json();
    })
    .post(async (req, res, next) => {
        let order = [];

        // find sessionId
        const sessionId = req.version === 1 ? req.body.sessionId : req.body.chatId;
        const product = req.product;

        // find a document in the firestore db
        const doc = db.doc(sessionId);
        const products = await doc.get();
        const data = { products: [] };

        if (products.data()) {
            data.products = products.data().products;
        }

        // find product in data from db
        const findProductIndex = data.products.findIndex(item => item.productName === product.productName);

        if (findProductIndex > -1) {
            data.products[findProductIndex].productQuantity += product.productQuantity;
        } else {
            data.products.push(product);
        }

        // update document
        await doc.set(data);
        order = data.products;

        if (order.length) {
            req.order = order;
            return next();
        }

        return res.json();
    })
    .post((req, res) => {
        let responses = [];

        if (req.version == 2) {
            responses = [
                {
                    type: 'text',
                    message: 'Product has been added successfully. Your order summary:'
                },
                {
                    type: 'text',
                    message: transformOrderToText(req.order)
                }
            ];
        } else {
            responses = [
                {
                    type: 'text',
                    elements: ['Product has been added successfully. Your order summary:']
                },
                {
                    type: 'text',
                    elements: [transformOrderToText(req.order)]
                }
            ];
        }

        // return responses back to the ChatBot
        res.json({ responses });
    });

// return order back to the ChatBot
router
    .route('/order-summary')
    .post(async (req, res) => {
        const sessionId = req.version === 1 ? req.body.sessionId : req.body.chatId;
        const doc = db.doc(sessionId);
        const products = await doc.get();

        // get order
        let order = products.data().products || [];
        let responses = [];

        if (req.version == 2) {
            responses = [
                {
                    type: 'text',
                    message: 'Your order summary:'
                },
                {
                    type: 'text',
                    message: transformOrderToText(order)
                }
            ];
        } else {
            responses = [
                {
                    type: 'text',
                    elements: ['Your order summary:']
                },
                {
                    type: 'text',
                    elements: [transformOrderToText(order)]
                }
            ];
        }

        res.json({ responses });
    });

// clear the order
router
    .route('/start-again')
    .post(async (req, res) => {
        // get the sessionId
        const sessionId = req.version === 1 ? req.body.sessionId : req.body.chatId;

        try {
            db.doc(sessionId).delete();
        } catch (e) {
            next(e);
        }

        res.json();
    });

app.use(router);

exports.restaurantBot = functions.https.onRequest((req, res) => {
    if (!req.path) {
        req.url = `/${req.url}`;
    }

    return app(req, res);
});
