const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const crypto = require("crypto");
const { messaging } = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_KEY);


//jwt
// const admin = require("firebase-admin");
// const serviceAccount = require("firebase-jwt.json");
// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount)
// });


//mongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@etuition.lmeq1nq.mongodb.net/?appName=etuition`;

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
        const tuitionsCollection = db.collection('tuitions');
        const tutorsCollection = db.collection('tutors');
        const paymentsCollection = db.collection('payments');
        const applicationsCollection = db.collection('applications');

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged MongoDB ...");

        //-----------------------------------------------------------------
        //***get APIS***

        //client.users <<< server <<< database
        app.get(`/users`, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.json(users);
        })

        //client.users <<< server <<< database
        app.get(`/tutors`, async (req, res) => {
            const tutors = await tutorsCollection.find().toArray();
            res.json(tutors);
        })

        //client.tuitions <<< server <<< database
        app.get('/tuitions', async (req, res) => {
            const tuitions = await tuitionsCollection
                .find()
                .sort({ createdAt: -1 })
                .toArray();

            res.json(tuitions);
        });

        //client.tuition.id <<< server <<< database
        app.get(`/tuitions/:id`, async (req, res) => {
            const { id } = req.params;
            try {
                const tuition = await tuitionsCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!tuition) {
                    return res.status(404).json({
                        message: "Cant Find this id"
                    })
                }
                res.json(tuition);
            }
            catch (err) {
                res.status(400).json({ message: "ID error" })
            }

        })



        //-----------------------------------------------------------------
        //***post APIS***

        //client.newuser >>> server >>> database
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.isAdmin = false;
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await userCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists already...' })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })


        //client.newtuition >>> server >>> database
        app.post(`/newtuition`, async (req, res) => {
            const newTuition = req.body;
            newTuition.paymentStatus = 'Pending';
            newTuition.approvalStatus = 'Pending';
            newTuition.image = `https://dummyimage.com/600x400/000/fff.png&text=${newTuition.subject}`
            newTuition.createdAt = new Date();

            const result = await tuitionsCollection.insertOne(newTuition);
            res.send(result);
        })

        //payment API
        app.post(`/checkout`, async (req, res) => {

            const tuitionInfo = req.body;
            const fee = tuitionInfo.fee;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'bdt',
                            unit_amount: fee,
                            product_data: {
                                name: `Payment for: ${tuitionInfo.subject}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    tuitionId: tuitionInfo._id
                },
                customer_email: tuitionInfo.creatorEmail,
                success_url: `${process.env.SITE_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_URL}/payment-cancelled`,
            })

            res.send({
                url: session.url
            })
        })

        //application for tuition
        app.post(`/apply`, async (req, res) => {

            const application = req.body;
            
            try {
                const result = await applicationsCollection.insertOne(application);
                res.status(201).send({
                    message: "Submitted",
                    insertedId: result.insertedId,
                })
            } catch (error) {
                console.log(error);
                res.status(500).send({
                    message: 'failed'
                })
            }
        })





        //-----------------------------------------------------------------
        //***patch APIS */

        app.patch('/tuitions/:id', async (req, res) => {
            const { id } = req.params;
            const updatedData = req.body;
            try {
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid ID format" });
                }
                const updated = await tuitionsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );
                res.json({
                    message: "Tuition updated",
                    updated
                });
            }
            catch (err) {
                console.error("error:", err);
                res.status(500).json({ error: "Failed" });
            }
        });




        //-----------------------------------------------------------------
        // ***delete APIS***
        app.delete(`/tuitions/delete/:id`, async (req, res) => {
            const { id } = req.params;

            try {
                const result = await tuitionsCollection.deleteOne({
                    _id: new ObjectId(id)
                });
                if (result.deletedCount === 0) {
                    return res.status(404).json({ message: "no tuition found" });
                }

                res.json({ message: "deleted successfully", deletedCount: result.deletedCount });

            } catch (err) {
                console.error("Error:", err);
                res.status(400).json({ message: "Invalid format or server error." });
            }
        });






    }
    //errorhandle
    catch { }
    finally { }
}


run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Server is running...')
})
app.listen(port, () => {
    console.log(`Listening on port ::: ${port}`)
})