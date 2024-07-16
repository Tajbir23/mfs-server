require('dotenv').config();
const express =  require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const crypto = require('crypto')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();

app.use(cors());
app.use(express.json());



// const uri = "mongodb+srv://tajbir23:<password>@cluster0.sdyx3bs.mongodb.net/?appName=Cluster0";
const uri = "mongodb://localhost:27017"

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization.split(" ")[1];
  
  if(!token){
    return res.status(401).send({message: "unauthorized"})
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if(err){
      console.log(err, 'error')
      return res.status(401).send({message: "unauthorized"})
    }
    req.decoded = decoded
    next()
  })
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    
    const db = client.db("instapay");

    const users = db.collection("users");

    app.post('/signup', async(req, res) => {
        const { name, email, phone, pin, role } = req.body;
        console.log(req.body);
        const user = { name, email, phone, role, status: 'pending' };;
        try {
            const existingUser = await users.findOne({ role, $or: [{ email }, { phone }] });
            
            if (existingUser) {
                return res.json({ error: 'User already exists' });
            }

            const hmac = crypto.createHmac('sha256', process.env.PIN_SECRET);
            hmac.update(pin)
            const pin_hash = hmac.digest('hex');
            user.pin = pin_hash;

            const result = await users.insertOne(user);
            console.log(result);


            const token = jwt.sign({ email, phone, role, status: 'pending' }, process.env.JWT_SECRET, { expiresIn: '1h' });
            res.json({ token });
        } catch (error) {
           res.json({ error: error.message }); 
        }
    })



    app.get('/auth', verifyToken, async (req, res) => {
      const user = req.decoded

      try {
        const data = await users.findOne({email: user.email, phone: user.phone, role: user.role})
        res.send({email: data.email, phone: data.phone, role: user.role, name: user.name, status: user.status})
      } catch (error) {
        res.status(404).send({message: "User not found"})
      }
     
    })


    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(process.env.PORT || 5000, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});