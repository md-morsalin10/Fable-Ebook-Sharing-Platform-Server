const express = require('express');
const app = express();
const cors = require("cors")
const dotenv = require("dotenv")
dotenv.config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;


app.use(cors())
app.use(express.json())

const uri = process.env.MONGO_URI;

app.get('/', (req, res) => {
  res.send('Hello World! Me');
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("Fable");
    const bookCollection = database.collection("books")
    const writersSubscriptionCollection = database.collection("writersSubscriptions")
    const usersCollection = database.collection("user")

    app.post("/api/subscription", async (req, res) => {
      // 🔍 ১. চেক করুন ফ্রন্টএন্ড থেকে আদৌ কোনো বডি বা ডেটা আসছে কিনা
      console.log("--- FRONTEND RECEIVED BODY ---", req.body);

      const { sessionId, writerId, priceId, writerName,writerEmail } = req.body;
      const isExist = await writersSubscriptionCollection.findOne({sessionId})
      if (isExist) {
        res.send({ message: "subscription already exist" })
        return
      }

      const result = await writersSubscriptionCollection.insertOne({
        sessionId,
        writerId,
        priceId,
        writerName,
        writerEmail
      });

      const updateResult = await usersCollection.updateOne(
        { _id: new ObjectId(writerId) },
        { $set: { plan: "pro" } }
      );

      console.log("--- MONGODB USER UPDATE RESULT ---", updateResult);

      res.send({ message: "subscription created", result });
    });


    app.post("/api/books", async (req, res) => {
      const book = req.body;
      const newBook = {
        ...book,
        createdAt: new Date(),
      }
      const result = await bookCollection.insertOne(newBook)
      res.send(result)
    })

    app.get("/api/books/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const book = await bookCollection.findOne(query)
      res.send(book)
    })

    app.get("/api/books", async (req, res) => {
      const query = {};
      if (req.query.writerId) {
        query.writerId = req.query.writerId
      }
      const books = await bookCollection.find(query).toArray()
      res.send(books)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});