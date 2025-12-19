const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const crypto = require("crypto");
const { messaging, auth } = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_KEY);
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@etuition.lmeq1nq.mongodb.net/?appName=etuition`;

//middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).send({ message: `No auth header found -verifyJWTToken` })
  }

  const token = authorization.split(' ')[1];
  if (!token) {
    return res.status(401).send({ message: `No Token Found in Auth Header, -verifyJWTToken` })
  }

  jwt.verify(token, process.env.JWT_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: `Token isnt Valid` })
    }
    req.token_email = decoded.email
    next()

  })
}

async function run() {
  try {
    // await client.connect();

    const db = client.db("etuition");
    const userCollection = db.collection("users");
    const tuitionsCollection = db.collection("tuitions");
    const tutorsCollection = db.collection("tutors");
    const applicationsCollection = db.collection("applications");


    ///JWT APIs
    app.post(`/getToken`, async (req, res) => {
      const loggedUser = req.body;
      const token = jwt.sign(loggedUser, process.env.JWT_KEY, { expiresIn: '30d' })
      res.send({ token: token });
    })

    const verifyAdmin = async (req, res, next) => {
      const email = req.token_email;

      try {
        const user = await userCollection.findOne({ email })

        if (user.userRole !== 'admin') {
          return res.status(403).send({ message: `admin action only -verifyAdmin` })
        }

        next()
      } catch (error) {
        res.status(500).send({ message: `server error during admin check, -verifyAdmin` })
      }
    };

    //-----------------------------------------------------------------
    //***get APIS***

    //fetch 3 tuitions and tutors
    app.get('/tuitions/limited', async (req, res) => {
      const cursor = tuitionsCollection.find()
        .sort({ createdAt: -1 })
        .limit(3);
      const result = await cursor.toArray();
      res.json(result);
    });

    app.get('/tutors/limited', async (req, res) => {
      const cursor = tutorsCollection.find()
        .sort({ createdAt: -1 })
        .limit(3);
      const result = await cursor.toArray();
      res.json(result);
    });

    //client.users <<< server <<< database
    app.get(`/users`, verifyToken, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.json(users);
    });

    //client.user:email <<< server <<< database
    app.get(`/users/:email`, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.json(user);
    });

    //client.userRole <<< server <<< database
    app.get(`/users/role/:email`, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.json({
        role: user?.userRole || "norolefound",
      });
    });

    //client.users <<< server <<< database
    app.get(`/tutors`, verifyToken, async (req, res) => {
      const tutors = await tutorsCollection.find().toArray();
      res.json(tutors);
    });

    //client.tutor:id <<< server <<< database
    app.get(`/tutors/:id`, verifyToken, async (req, res) => {
      const tutor = await tutorsCollection.findOne({
        _id: new ObjectId(req.params.id),
        userRole: "tutor",
      });
      res.json(tutor);
    });

    //client.tuitions <<< server <<< database
    app.get("/tuitions", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;
        const totalCount = await tuitionsCollection.countDocuments({
          isAdminApproved: true
        });
        const tuitions = await tuitionsCollection
          .find({ isAdminApproved: true })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalPages = Math.ceil(totalCount / limit);

        res.json({
          totalCount,
          totalPages,
          tuitions,
          currentPage: page,
          hasNext: page < totalPages,
          hasPrev: page > 1
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "erro when fetcing from database" });
      }
    });

    //ADMIN.allTuitions <<< DATABASE
    app.get(`/admin/tuitions/all`, verifyToken, verifyAdmin, async (req, res) => {
      const allTuitions = await tuitionsCollection.find()
        .toArray();
      res.json(allTuitions)
    })

    //client.tuition.id <<< server <<< database
    app.get(`/tuitions/:id`, verifyToken, async (req, res) => {
      const { id } = req.params;
      try {
        const tuition = await tuitionsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tuition) {
          return res.status(404).json({
            message: "Cant Find this id",
          });
        }
        res.json(tuition);
      } catch (err) {
        res.status(400).json({ message: "ID error" });
      }
    });

    //client.myTuition <<< server <<< database
    app.get(`/tuitions/creator/:email`, verifyToken, async (req, res) => {
      const email = req.params.email;
      const tuitions = await tuitionsCollection
        .find({
          creatorEmail: email,
        })
        .toArray();
      res.json(tuitions);
    });

    //client.studentPayments <<< server <<< database
    app.get(`/tuitions/payee/:email`, verifyToken, async (req, res) => {
      const email = req.params.email;
      const payments = await applicationsCollection
        .find({
          creatorEmail: email,
          paymentStatus: "Paid",
        })
        .toArray();
      res.json(payments);
    });

    //ADMIN.ALLPAYMENTS <<< DATABASE
    app.get(`/admin/payments-log`, verifyToken, verifyAdmin, async (req, res) => {
      try {
        const paymentsLog = await applicationsCollection.find({
          paymentStatus: "Paid",
        }).toArray();
        res.send(paymentsLog)
      } catch (error) {
      }
    })

    //client.applications <<< server <<< database
    app.get(`/applications/creator/:email`, verifyToken, async (req, res) => {
      const tutorEmail = req.params.email;
      const applications = await applicationsCollection
        .find({
          tutorEmail: tutorEmail,
        })
        .toArray();
      res.json(applications);
    });

    //client.application:creator <<< server <<< database
    app.get(`/applications/tuitioncreator/:creator`, verifyToken, async (req, res) => {
      const user = req.params.creator;
      const applicants = await applicationsCollection
        .find({
          creatorEmail: user,
        })
        .toArray();
      res.json(applicants);
    });

    //client.approvedApplications <<< server <<<database
    app.get(`/applications/approved/:tutorEmail`, verifyToken, async (req, res) => {
      const tutorEmail = req.params.tutorEmail;
      const approvedApplications = await applicationsCollection.find({
        tutorEmail: tutorEmail,
        applicationStatus: "Approved",
      })
        .toArray();
      res.send(
        approvedApplications
      )
    })

    //-----------------------------------------------------------------
    //***post APIS***

    //client.newuser >>> server >>> database
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.isAdmin = false;
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists already..." });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    //client.newtutor >>> server >>> database
    app.post("/tutors", async (req, res) => {
      const tutor = req.body;
      const result = await tutorsCollection.insertOne(tutor);
      res.status(201).json({ insertedId: result.insertedId });
    });

    //client.newtuition >>> server >>> database
    app.post(`/newtuition`, verifyToken, async (req, res) => {
      const newTuition = req.body;
      newTuition.paymentStatus = "Pending";
      newTuition.approvalStatus = "Pending";
      newTuition.isAdminApproved = false;
      newTuition.image = `https://dummyimage.com/600x400/000/fff.png&text=${newTuition.subject}`;
      newTuition.createdAt = new Date();

      const result = await tuitionsCollection.insertOne(newTuition);
      res.send(result);
    });

    //payment API
    app.post(`/checkout`, verifyToken, async (req, res) => {
      const tuitionInfo = req.body;
      const fee = tuitionInfo.fee;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: fee,
              product_data: {
                name: `Payment for: ${tuitionInfo.subject}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          tuitionId: tuitionInfo._id,
        },
        customer_email: tuitionInfo.creatorEmail,
        success_url: `${process.env.SITE_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_URL}/dashboard/my-tuitions`,
      });

      res.send({
        url: session.url,
      });
    });

    //update payment status
    app.post("/payment-success", verifyToken, async (req, res) => {
      const { session_id } = req.body;

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status !== "paid") {
          return res.status(400).json({ message: "Payment not completed" });
        }

        if (session.metadata.tuitionId) {
          await tuitionsCollection.updateOne(
            { _id: new ObjectId(session.metadata.tuitionId) },
            { $set: { paymentStatus: "Paid", paymentDate: new Date() } }
          );
        }

        if (session.metadata.applicationId) {
          await applicationsCollection.updateOne(
            { _id: new ObjectId(session.metadata.applicationId) },
            {
              $set: {
                applicationStatus: "Approved",
                paymentStatus: "Paid",
                paidAt: new Date(),
              },
            }
          );
        }

        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    //checkout Tutor Payment
    app.post(`/checkout-tutor`, verifyToken, async (req, res) => {
      try {
        const applicationInfo = req.body;
        const fee = applicationInfo.fee;
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "bdt",
                unit_amount: fee,
                product_data: {
                  name: `Payment for: ${applicationInfo.subject}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            applicationId: applicationInfo._id,
          },
          customer_email: applicationInfo.creatorEmail,
          success_url: `${process.env.SITE_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_URL}/dashboard/my-tuitions`,
        });

        res.send({
          url: session.url,
        });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    //application for tuition
    app.post(`/apply`, verifyToken, async (req, res) => {
      const application = req.body;

      try {
        const result = await applicationsCollection.insertOne(application);
        res.status(201).send({
          message: "Submitted",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({
          message: "failed",
        });
      }
    });

    //-----------------------------------------------------------------
    //***patch APIS */

    app.patch("/tuitions/:id", verifyToken, async (req, res) => {
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
          updated,
        });
      } catch (err) {
        console.error("error:", err);
        res.status(500).json({ error: "Failed" });
      }
    });

    //tutor.updateApplication >>> database
    app.patch("/update-application/:id", verifyToken, async (req, res) => {
      const updateData = req.body;
      const { id } = req.params;

      try {
        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.send({
          message: `failed`,
        });
      }
    });

    //ADMIN.UPDATEUSER >>> DATABASE
    app.patch(`/admin/update-user/:userId`, verifyToken, verifyAdmin, async (req, res) => {
      const updateData = req.body;
      const { userId } = req.params;

      try {
        const result = await userCollection.updateOne({
          _id: new ObjectId(userId)
        }, {
          $set: updateData
        })
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.send({
          message: `failed`,
        });
      }
    })

    //update.user <<< server <<< database
    app.patch(`/users/:email`, verifyToken, async (req, res) => {
      const updateData = req.body;
      const { email } = req.params;

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: updateData }
        );
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.send({
          message: `error`,
        });
      }
    });

    //client reject other tutors >>> server >>> database
    app.patch("/applications/reject/:rejectedTutorId", verifyToken, async (req, res) => {
      const { rejectedTutorId } = req.params;

      try {
        const result = await applicationsCollection.updateOne({
          _id: new ObjectId(rejectedTutorId)
        }, {
          $set: { applicationStatus: "Rejected" }
        })
        res.json({
          success: true,
          message: `rejected tutor successfully.`,
        })
      } catch (error) {
        res.json({
          message: `failed rejecting other tutors`
        })

      }
    });

    //ADMIN.ACCEPTTUITION >>> DATABASE
    app.patch(`/admin/tuitions/accept/:tuitionId`, verifyToken, verifyAdmin, async (req, res) => {
      const tuitionId = req.params.tuitionId;
      try {
        const result = await tuitionsCollection.updateOne({
          _id: new ObjectId(tuitionId)
        }, {
          $set: { isAdminApproved: true }
        })
        res.json({
          success: true,
          message: `accepted as admin successfully`
        })
      } catch (error) {
        res.json({
          message: `unable to accept tuition as admin`
        })
      }
    })


    //-----------------------------------------------------------------
    // ***delete APIS***
    //ADMIN.DELETETUITION >>> DATABASE
    app.delete(`/admin/tuitions/delete/:tuitionId`, verifyToken, verifyAdmin, async (req, res) => {
      const tuitionId = req.params.tuitionId
      try {
        const result = await tuitionsCollection.deleteOne({
          _id: new ObjectId(tuitionId)
        })
        if (result.deletedCount === 0) {
          return res.json({
            message: `no such tuition found to delete as admin`
          })
        }
        res.json({
          success: true,
          message: `deleted as admin successfully`
        })
      } catch (error) {
        res.json({ message: `failed to delete as admin` })
      }
    })

    //ADMIN DELETE USER
    app.delete(`/admin/users/delete/:userId`, verifyToken, verifyAdmin, async (req, res) => {
      const userId = req.params.userId
      try {
        const result = await userCollection.deleteOne({
          _id: new ObjectId(userId)
        })
        if (result.deletedCount === 0) {
          return res.json({
            message: `no user found to delete as admin`
          })
        }
        res.json({
          success: true,
          message: `deleted user as admin successfully`
        })
      } catch (error) {
        res.json({ message: `failed to delete user as admin` })
      }
    })

    app.delete(`/tuitions/delete/:id`, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await tuitionsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "no tuition found" });
        }

        res.json({
          message: "deleted successfully",
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        console.error("Error:", err);
        res.status(400).json({ message: "Invalid format or server error." });
      }
    });

    //application.delete >>> database
    app.delete(`/applications/delete/:id`, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await applicationsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.json({
          message: `deleted application`,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        res.json({
          message: `error`,
        });
      }
    });


  } catch {
    //errorhandle
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running...");
});

app.listen(port, () => {
  console.log(`Listening on port ::: ${port}`);
});

