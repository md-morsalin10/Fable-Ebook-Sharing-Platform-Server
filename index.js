const express = require('express');
const app = express();
const cors = require("cors")
const dotenv = require("dotenv")
dotenv.config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');
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

// const verifyToken = async (req, res, next) =>{
//   console.log("headers", req.headers)
//   next()
// }

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  // console.log(authHeader, "authHeader");
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Missing or invalid authorization header' });
  }
  const token = authHeader.split(' ')[1];
  // console.log(token, "token");
  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    // console.log(payload, "payload");
    next();


  } catch (err) {
    // console.log(err, "err");
    res.status(401).send({ message: 'Invalid token' });
  }

}


const writerVerify = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "writer" || user.plan !== "pro") {
    return res.status(403).send({ message: "You are not authorized to access this route" });
  }
  next();
};



const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).send({ message: "Unauthorized access" });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).send({ message: "You do not have permission to access this resource" });
    }

    next();
  };
};



// async function run() {
//   try {
//     // Connect the client to the server	(optional starting in v4.7)
//     await client.connect();

client.connect(() => {
  console.log("Connected to MongoDB")
}).catch(console.dir)

const database = client.db("Fable");
const bookCollection = database.collection("books")
const writersSubscriptionCollection = database.collection("writersSubscriptions")
const usersCollection = database.collection("user");
const readerPaymentCollection = database.collection("readerPayment");
const bookmarkCollection = database.collection("bookmark");


app.get("/api/bookmarks", verifyToken, authorizeRoles("writer", "reader"), async (req, res) => {
  const { userId } = req.query;
  const query = { userId };
  const bookmarks = await bookmarkCollection.find(query).toArray();
  res.send(bookmarks);

});

app.get("/api/features/books", async (req, res) => {
  const query = {};
  const books = await bookCollection.find(query).limit(6).sort({ createdAt: -1 }).toArray();
  res.send(books);
})

app.get("/api/users", verifyToken, authorizeRoles("admin"), async (req, res) => {
  const result = await usersCollection.find().sort({ createdAt: -1 }).toArray();
  res.send(result);
});

app.post("/api/bookmarks/toggle", verifyToken, authorizeRoles("writer", "reader"), async (req, res) => {
  try {
    const { userId, bookId, title, coverImage, price, genre, writerName } = req.body;

    const isExist = await bookmarkCollection.findOne({ userId, bookId });

    if (isExist) {
      await bookmarkCollection.deleteOne({ userId, bookId });
      return res.send({ message: "Bookmark removed", isBookmarked: false });
    } else {

      const result = await bookmarkCollection.insertOne({
        userId,
        bookId,
        title,
        coverImage,
        price,
        genre,
        writerName,
        createdAt: new Date()
      });
      return res.send({ message: "Bookmark added", isBookmarked: true, result });
    }
  } catch (error) {
    console.error("Bookmark Error:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.get("/api/writers/fee", verifyToken, authorizeRoles("admin"), async (req, res) => {
  const query = {};
  const fee = await writersSubscriptionCollection.find(query).toArray();
  res.send(fee);
});



app.post("/api/subscription", async (req, res) => {
  const { sessionId, writerId, priceId, writerName, writerEmail } = req.body;
  const isExist = await writersSubscriptionCollection.findOne({ sessionId })
  if (isExist) {
    res.send({ message: "subscription already exist" })
    return
  }
  const result = await writersSubscriptionCollection.insertOne({
    sessionId,
    writerId,
    priceId,
    writerName,
    price: Number(price || 19.99),
    writerEmail
  });
  const updateResult = await usersCollection.updateOne(
    { _id: new ObjectId(writerId) },
    { $set: { plan: "pro" } }
  );
  res.send({ message: "subscription created", result });
});

app.get("/api/payment", verifyToken, authorizeRoles("writer", "reader", "admin"), async (req, res) => {
  const query = {};
  if (req.query.userId) {
    query.userId = req.query.userId
  }
  if (req.query.userEmail) {
    query.userEmail = req.query.userEmail
  }

  if (req.query.writerId) {
    query.writerId = req.query.writerId
  }

  const userPayment = await readerPaymentCollection.find(query).toArray()
  res.send(userPayment)
})

app.post("/api/payment", async (req, res) => {
  const { sessionId, writerId, price, writerName, writerEmail, title, bookId, userName, userEmail, userId, coverImage } = req.body;

  const isExist = await readerPaymentCollection.findOne({ sessionId })
  if (isExist) {
    res.send({ message: "subscription already exist" })
    return
  }

  const result = await readerPaymentCollection.insertOne({
    sessionId,
    writerId,
    price,
    writerName,
    writerEmail,
    title,
    bookId,
    userName,
    userEmail,
    userId,
    coverImage,
    purchaseDate: new Date()
  });

  const updateResult = await bookCollection.updateOne(
    { _id: new ObjectId(bookId) },
    {
      $set: {
        status: "sold",
        buyerEmail: userEmail,
        buyerId: userId,
        buyerName: userName
      }
    }
  );

  console.log("--- MONGODB USER UPDATE RESULT ---", updateResult);
  res.send({ message: "subscription created", result });
});

app.post("/api/books", verifyToken, writerVerify, async (req, res) => {
  const book = req.body;
  const newBook = {
    ...book,
    createdAt: new Date(),
    status: book.status || "unpublished",
  }
  const result = await bookCollection.insertOne(newBook)
  res.send(result)
})



app.get("/api/books", async (req, res) => {
  const query = {};

  if (req.query.writerId) {
    query.writerId = req.query.writerId;
  }

  const books = await bookCollection.find(query).toArray();
  res.send(books);
});


app.get("/api/books/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { userEmail } = req.query;

  const query = { _id: new ObjectId(id) };
  const book = await bookCollection.findOne(query);

  if (!book) {
    return res.status(404).send({ message: "Book not found" });
  }

  const isWriter = userEmail && userEmail === book.writerEmail;


  if (book.status === "unpublished" && !isWriter) {
    return res.status(403).send({ message: "This book is currently unavailable" });
  }

  const isBuyer = userEmail && userEmail === book.buyerEmail;
  const isSold = book.status?.toLowerCase() === 'sold';

  if (isSold && !isWriter && !isBuyer) {
    if (book.fullContent) {
      delete book.fullContent;
    }
  }

  res.send(book);
});


//  for book update 
app.patch("/api/books/update/:id", verifyToken, writerVerify, async (req, res) => {
  try {
    const id = req.params.id;
    const { title, description, genre, price, coverImage } = req.body;

    const query = { _id: new ObjectId(id) };


    const updateDoc = {
      $set: {
        title,
        description,
        genre,
        price: parseFloat(price),
        coverImage,
        updatedAt: new Date()
      }
    };

    const result = await bookCollection.updateOne(query, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "Ebook not found" });
    }

    res.send({ success: true, message: "Ebook updated successfully!", result });
  } catch (error) {
    console.error("Update Ebook Error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
});

// publish or unpublish book (Updated to match Frontend)
app.patch("/api/books/status/:id", verifyToken, writerVerify, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const query = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        status: status
      }
    };

    const result = await bookCollection.updateOne(query, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Book not found" });
    }

    res.send({ success: true, message: `Book status updated to ${status}` });
  } catch (error) {
    console.error("Toggle Status Error:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});


// delete books
app.delete("/api/books/delete/:id", verifyToken, writerVerify, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const result = await bookCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).send({ success: false, message: "Ebook not found or already deleted" });
    }

    res.send({ success: true, message: "Ebook deleted successfully!", result });
  } catch (error) {
    console.error("Delete Ebook Error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
});

// delete books (Updated to match Frontend)
app.delete("/api/admin/books/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const result = await bookCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).send({ success: false, message: "Ebook not found or already deleted" });
    }

    res.send({ success: true, message: "Ebook deleted successfully!", result });
  } catch (error) {
    console.error("Delete Ebook Error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
});



// user delete 
app.delete("/api/admin/users/:id", verifyToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const result = await usersCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).send({ success: false, message: "User not found or already deleted" });
    }

    res.send({ success: true, message: "User deleted successfully!", result });
  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
});

app.patch("/api/admin/users/role/:id", verifyToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body;

    const validRoles = ["reader", "writer", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).send({ success: false, message: "Invalid role specified" });
    }

    const query = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        role: role,
        updatedAt: new Date()
      }
    };

    const result = await usersCollection.updateOne(query, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    res.send({ success: true, message: `User role updated to ${role} successfully!`, result });
  } catch (error) {
    console.error("Role Update Error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
});

// app.get("/api/books/:id", async (req, res) => {
//   const id = req.params.id;
//   const query = { _id: new ObjectId(id) }

//   const book = await bookCollection.findOne(query)
//   res.send(book)
// })

// publish or unpublish book (Updated to match Frontend)


app.patch("/api/admin/books/status/:id", verifyToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const query = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        status: status
      }
    };

    const result = await bookCollection.updateOne(query, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Book not found" });
    }

    res.send({ success: true, message: `Book status updated to ${status}` });
  } catch (error) {
    console.error("Toggle Status Error:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});



app.get("/api/admin/analytics", verifyToken, authorizeRoles("admin"), async (req, res) => {
  try {

    const totalUsers = await usersCollection.countDocuments({ role: "reader" });
    const totalWriters = await usersCollection.countDocuments({ role: "writer" });
    const totalEbooksSold = await bookCollection.countDocuments({ status: "sold" });

    const readerPayments = await readerPaymentCollection.find().toArray();
    const writerSubscriptions = await writersSubscriptionCollection.find().toArray();

    const totalReaderRevenue = readerPayments.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const totalWriterRevenue = writerSubscriptions.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const totalRevenue = totalReaderRevenue + totalWriterRevenue;


    const genreData = await bookCollection.aggregate([
      { $group: { _id: "$genre", count: { $sum: 1 } } }
    ]).toArray();


    const monthlySalesData = await readerPaymentCollection.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$purchaseDate" } },
          totalSales: { $sum: { $toDouble: "$price" } }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    res.send({
      cards: { totalUsers, totalWriters, totalEbooksSold, totalRevenue },
      genreChart: genreData.map(item => ({ genre: item._id || "Others", count: item.count })),
      monthlySalesChart: monthlySalesData.map(item => ({ month: item._id, amount: item.totalSales }))
    });

  } catch (error) {
    console.error("Analytics Endpoint Error:", error);
    res.status(500).send({ message: "Internal server error" });
  }
});

// Send a ping to confirm a successful connection
// await client.db("admin").command({ ping: 1 });


//     console.log("Pinged your deployment. You successfully connected to MongoDB!");
//   } finally {
//     // Ensures that the client will close when you finish/error
//     // await client.close();
//   }
// }

// run().catch(console.dir);



app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;