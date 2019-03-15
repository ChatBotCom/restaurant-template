'use strict';

const TOKEN = '{{YOUR_TOKEN}}'; // put your authorization token here

const express = require('express');
const { Router } = require('express');
const router = new Router();
const app = express();
const functions = require('firebase-functions');
const firebase = require('firebase-admin');

firebase.initializeApp({
    credential: firebase.credential.applicationDefault(),
    databaseURL: '{{YOUR_DATABASE_URL}}' // put url to your firebase database here
});

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

        const action = req.body.result.interaction.action;

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
        const { result } = req.body;

        // get attributes collected in the ongoing chat
        const productName = result.sessionParameters.productName;
        const productQuantity = Number(result.sessionParameters.productQuantity);

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
        let order;

        // get the sessionId from the ongoing request
        const { sessionId } = req.body;
        const product = req.product;

        // database
        const db = firebase.database();
        const ref = db.ref(sessionId.substring(2));

        // open database transaction; find the order based on the sessionId
        try {
            await ref.transaction((data) => {
                if (data === null) {
                    data = [product];
                } else {
                    // find the product and increment the productQuantity or add a new one
                    const findProduct = data.find(item => item.productName === product.productName);

                    if (findProduct) {
                        findProduct.productQuantity += product.productQuantity;
                    } else {
                        data.push(product);
                    }
                }

                // store current order
                order = data;
                return data;
            });
        } catch (e) {
           next(e);
        }

        // go to the next part
        if (order.length) {
            req.order = order;
            return next();
        }

        return res.json();
    })
    .post((req, res) => {
        const data = {
            responses: [
                {
                    type: 'text',
                    elements: ['Product has been added successfully. Your order summary:']
                },
                {
                    type: 'text',
                    elements: [transformOrderToText(req.order)] // usem function for transform order to the text message
                }
            ]
        };

        // return responses back to the ChatBot
        res.json(data);
    });

// return order back to the ChatBot
router
    .route('/order-summary')
    .post(async (req, res) => {
        let order;

        // get the sessionId
        const { sessionId } = req.body;

        try {
            // database
            const db = firebase.database();
            const ref = db.ref(sessionId.substring(2));

            // open database transaction; store the order
            await ref.transaction((data) => {
                order = data;
                return order;
            });
        } catch (e) {
            next(e);
        }

        res.json({
            responses: [
                {
                    type: 'text',
                    elements: ['Your order summary:']
                },
                {
                    type: 'text',
                    elements: [transformOrderToText(order)] // use the function for transform order to the text message
                }
            ]
        });
    });

// clear the order
router
    .route('/start-again')
    .post(async (req, res) => {
        // get the sessionId
        const { sessionId } = req.body;

        try {
            // database
            const db = firebase.database();
            const ref = db.ref(sessionId.substring(2));

            await ref.transaction(() => {
                return [];
            });
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
