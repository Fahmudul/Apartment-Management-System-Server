const express = require("express");
const app = express();
const cors = require("cors");
var jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();
//TOdo : Payment API
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

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
    // cosnt
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });

    // JWT Token API create jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      // console.log("email from jwt", email);
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10d",
      });
      // console.log(token);
      res.send(token);
    });
    //Payment API
    app.post("/create-payment-intent", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // All Room API
    app.get("/allRooms", verifyJWT, async (req, res) => {
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
      // console.log(result);
      res.send(result);
    });

    //Get All Agreements
    app.get("/agreementRequest", async (req, res) => {
      const result = await aggrementCollection.find().toArray();
      res.send(result);
    });

    //Add Agrement in aggrement list collection
    app.post("/agreements", async (req, res) => {
      const aggrementDetails = req.body;
      const email = req.query.email;
      console.log(email);
      const query = { customerEmail: email };
      const user = await acceptedAggrementCollection.findOne(query);
      const alreadyAgreed = await aggrementCollection.findOne(query);
      console.log("aggreList", user, "alreadyAggrelist", alreadyAgreed);
      if (user || alreadyAgreed) {
        return res
          .status(406)
          .send({ message: "You can only have one agreement!" });
      }
      const result = await aggrementCollection.insertOne(aggrementDetails);
      res.send(result);
    });

    // Accept/Decline Agrement
    app.patch("/agreements", async (req, res) => {
      const email = req.query.email;
      const action = req.body.action;
      // console.log("route hitted");
      // console.log(email, action);
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
      // console.log(acceptedAggrement);
      // Checking if user is already in accepted collection
      const isFound = await acceptedAggrementCollection.findOne(findEmailQuery);
      if (!isFound) {
        const result3 = await acceptedAggrementCollection.insertOne(
          acceptedAggrement
        );
      }
      const result4 = await aggrementCollection.deleteOne(findEmailQuery);
      res.send(result4);
    });
    // User Collection
    app.post("/users", async (req, res) => {
      const user = req.body;
      const isFound = await userCollection.findOne({ email: user.email });
      // console.log(isFound);
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
    //Check is admin
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.send(user);
    });

    // Number of Appartments
    app.get("/allAppartments", async (req, res) => {
      const count = await roomCollection.countDocuments();
      res.send({ count });
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
