const express = require("express");
const app = express();
const cors = require("cors");
var jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
//TOdo : Payment API
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://cozynest-cbb8e.web.app",
      "https://cozynest-cbb8e.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nkzn5jr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" ? true : false,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

// Middlewares
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    const roomCollection = client
      .db("CozyNest")
      .collection("AppartmentCollection");
    const aggrementCollection = client.db("CozyNest").collection("Aggrements");
    const userCollection = client.db("CozyNest").collection("Users");
    const acceptedAggrementCollection = client
      .db("CozyNest")
      .collection("AcceptedAggrements");
    const couponCollection = client.db("CozyNest").collection("Coupons");
    const announcementCollection = client
      .db("CozyNest")
      .collection("Announcements");
    const paymentCollection = client.db("CozyNest").collection("Payments");
    // cosnt
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });

    // Verify admin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };

      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // JWT Token API create jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10d",
      });
      res.send(token);
    });
    //Payment API
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });
    // Get all payment details
    app.get("/payments", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();

      res.send(result);
    });
    // Add payment to payment collection
    app.post("/paymentsHistory", verifyJWT, async (req, res) => {
      const payment = req.body;

      const result = await paymentCollection.insertOne(payment);

      res.send(result);
    });
    // All Room API
    app.get("/allRooms", async (req, res) => {
      const skip = parseInt(req.query.skip);
      const limit = parseInt(req.query.limit);
      const rooms = await roomCollection
        .find()
        .skip((skip - 1) * limit)
        .limit(limit)
        .toArray();
      res.send(rooms);
    });

    //Get agreement by email for member only. Used in Payment on client side
    app.get("/agreements", verifyJWT, async (req, res) => {
      const email = req.query.email;

      const query = { customerEmail: email };
      const result = await acceptedAggrementCollection.findOne(query);

      res.send(result);
    });

    //Get All Agreements
    app.get("/agreementRequest", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await aggrementCollection.find().toArray();
      res.send(result);
    });

    //Add Agrement in aggrement list collection
    app.post("/agreements", verifyJWT, async (req, res) => {
      const aggrementDetails = req.body;
      const email = req.query.email;
      const query = { customerEmail: email };
      const roomId = aggrementDetails.roomId;

      const user = await acceptedAggrementCollection.findOne(query);
      const alreadyAgreed = await aggrementCollection.findOne(query);

      if (user || alreadyAgreed) {
        return res
          .status(406)
          .send({ message: "You can only have one agreement!" });
      }
      const result = await aggrementCollection.insertOne(aggrementDetails);
      //Change room availability status
      const updatedDoc = {
        $set: {
          ready: "Already Booked",
        },
      };
      const filter = { _id: new ObjectId(roomId) };
      const filter_2 = { roomId };
      const result2 = await roomCollection.updateOne(filter, updatedDoc);
      //Update room availability status in aggrement list
      const updatedAggrementDoc = aggrementCollection.updateOne(
        filter_2,
        updatedDoc
      );

      res.send(result);
    });

    // Accept/Decline Agrement
    app.patch("/agreements", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.query.email;

      const action = req.body.action;
      const roomId = req.body.roomId;

      const updatedStatus = {
        $set: {
          status: "checked",
        },
      };
      const query = { email: email };
      if (action === "accepted") {
        updatedDoc = {
          $set: {
            role: "member",
          },
        };
      } else if (action === "declined") {
        updatedDoc = {
          $set: {
            role: "user",
          },
        };
        const filter = { _id: new ObjectId(roomId) };
        const result2 = await roomCollection.updateOne(filter, {
          $set: { ready: "Ready For You!" },
        });
      }

      const result = await userCollection.updateOne(query, updatedDoc);
      // Remove aggrement from list
      const findEmailQuery = { customerEmail: email };
      const result2 = await aggrementCollection.updateOne(
        findEmailQuery,
        updatedStatus
      );
      //Get accepted agreements and save to accepted collection
      const acceptedAggrement = await aggrementCollection.findOne(
        findEmailQuery
      );

      // Checking if user is already in accepted collection
      const isFound = await acceptedAggrementCollection.findOne(findEmailQuery);

      if (!!isFound || action === "accepted") {
        const result3 = await acceptedAggrementCollection.insertOne(
          acceptedAggrement
        );
      }
      const result4 = await aggrementCollection.deleteOne(findEmailQuery);
      res.send(result4);
    });
    //Add  User to Collection
    app.post("/users", async (req, res) => {
      const user = req.body;

      const isFound = await userCollection.findOne({ email: user.email });

      if (isFound) {
        return res.send({ message: "Already registered!" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // User Collection
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    //Change member role to user
    app.patch("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.query.email;

      const filter = { email: email };
      const filter_2 = { customerEmail: email };
   
      // Todo: change room availability status
      const updatedDoc = {
        $set: {
          role: "user",
        },
      };
      const findUser = await acceptedAggrementCollection.findOne(filter_2);
      const bookedRoomId = findUser?.roomId;
      if (bookedRoomId) {
        const filter_3 = { _id: new ObjectId(bookedRoomId) };
        const result2 = await roomCollection.updateOne(filter_3, {
          $set: { ready: "Ready For You!" },
        });

        const result3 = await acceptedAggrementCollection.deleteOne(filter_2);
      }


      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    //Check is admin
    app.get("/users/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.send(user);
    });

    //Get Accepted user
    app.get("/acceptedUsers", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { customerEmail: email };
      const result = await acceptedAggrementCollection.findOne(query);
      res.send(result);
    });

    // Save coupon
    app.post("/coupon", verifyJWT, verifyAdmin, async (req, res) => {
      const coupon = req.body;
      const result = await couponCollection.insertOne(coupon);
      res.send(result);
    });

    //Get all coupon
    app.get("/coupon", async (req, res) => {
      const coupon = await couponCollection.find({}).toArray();
      res.send(coupon);
    });

    //Chnage coupon expiry
    app.patch("/coupon", verifyJWT, verifyAdmin, async (req, res) => {
      const expirationTime = req.body.newExpriationDate;
      const couponId = req.body.couponId;
      const filter = { _id: new ObjectId(couponId) };
      const updatedTime = {
        $set: {
          expriation: expirationTime,
        },
      };
      const result = await couponCollection.updateOne(filter, updatedTime);
      res.send(result);
    });
    // Number of Appartments
    app.get("/allAppartments", async (req, res) => {
      const count = await roomCollection.countDocuments();
      res.send({ count });
    });
    //Get all announcements
    app.get("/announcements", verifyJWT, async (req, res) => {
      const announcements = await announcementCollection.find({}).toArray();
      res.send(announcements);
    });
    // Save announcements to database
    app.post("/announcements", verifyJWT, verifyAdmin, async (req, res) => {
      const announcement = req.body;
      const result = await announcementCollection.insertOne(announcement);
      res.send(result);
    });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("CozyNest Server is running");
});

app.listen(port, () => {
  console.log(`CozyNest sitting on ${port}`);
});
