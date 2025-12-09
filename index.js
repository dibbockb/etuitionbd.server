const express = require('express')
const cors = require('cors');
const app = express();
// require('dotenv').config();

//stripe
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const crypto = require("crypto");

//jwt
// const admin = require("firebase-admin");
// const serviceAccount = require("firebase-jwt.json");
// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount)
// });


//mongoDB
const uri = "mongodb+srv://7SD7KDbrcLsiVkCw:7SD7KDbrcLsiVkCw@etuition.lmeq1nq.mongodb.net/?appName=etuition";

//midleware 
app.use(express.json());
app.use(cors());

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        await client.connect();

        const db = client.db('etuition');
        const userCollection = db.collection('users');


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged MongoDB ...");
    } finally {
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Server is running...')
})

app.listen(port, () => {
    console.log(`Listening on port ::: ${port}`)
})