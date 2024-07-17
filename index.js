require('dotenv').config();
const express =  require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const crypto = require('crypto')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();

app.use(cors());
app.use(express.json());



// const uri = "mongodb+srv://tajbir:y6mcEooEI4Is8FCb@cluster0.sdyx3bs.mongodb.net/?appName=Cluster0";
const uri = "mongodb://localhost:27017"
// const uri = "mongodb://tajbir:123@localhost:27017"

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  
  if(!token){
    return res.status(401).send({message: "unauthorized"})
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if(err){
      return res.status(403).send({message: "unauthorized"})
    }
    req.decoded = decoded
    next()
  })
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    console.log('database is connecting')
    await client.connect();
    console.log('database is connected')
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    
    const db = client.db("instapay");

    const users = db.collection("users");
    const transaction = db.collection("transaction");

    app.post('/signup', async(req, res) => {
        const { name, email, phone, pin, role } = req.body;
        

        const user = { name, email, phone, role, status: 'pending', balance: 0 };
        try {
            const existingUser = await users.findOne({ role, $or: [{ email }, { phone }] });
            
            if (existingUser) {
                return res.status(400).send({ error: 'Phone or email already exists' });
            }

            const hmac = crypto.createHmac('sha256', process.env.PIN_SECRET);
            hmac.update(pin)
            const pin_hash = hmac.digest('hex');
            user.pin = pin_hash;

            const result = await users.insertOne(user);


            // const token = jwt.sign({ email, phone, role, status: 'pending' }, process.env.JWT_SECRET, { expiresIn: '1h' });
            // res.send({ token, email: user.email, phone: user.phone, role: user.role, name: user.name, status: user.status, balance: user.balance });
            res.send({ message: "Registration successful" });
        } catch (error) {
           res.send({ error: error.message }); 
        }
    })



    app.get('/auth', verifyToken, async (req, res) => {
      const user = req.decoded

      
      try {
        const data = await users.findOne({email: user.email, phone: user.phone, role: user.role})
        res.send({email: data.email, phone: data.phone, role: data.role, name: data.name, status: data.status, balance: data.balance})
      } catch (error) {
        res.status(403).send({message: "User not found"})
      }
     
    })

    app.post('/login', async (req, res) => {
      const {text, pin} = req.body
      
      try {
        if(!text ||!pin){
          return res.status(400).send({error: 'Missing credentials'})
        }
        const hmac = crypto.createHmac('sha256', process.env.PIN_SECRET);
        hmac.update(pin)
        const pin_hash = hmac.digest('hex');
        
        const user = await users.findOne({ $or: [{email: text}, { phone: text}], pin: pin_hash });
        
        if(!user){
          return res.status(404).send({error: 'Invalid credentials'})
        }

        if(user.status === 'pending'){
          return res.status(400).send({error: 'Your account is not active'})
        }
        if(user.status === 'block'){
          return res.status(400).send({error: 'You have been blocked'})
        }

        const token = jwt.sign({ email: user.email, phone: user.phone, role: user.role, name: user.name, status: user.status }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.send({ token });
        } catch (error) {
          res.send(error.message)
        }

    })

    app.get('/manage_user', verifyToken, async(req, res) => {
      const decode = req.decoded
      const {search} = req.query

      if(decode.role!== 'admin'){
        return res.status(403).send({message: "unauthorized"})
      }

      try {
        const searchPattern = new RegExp(search, 'i');

      const usersData = await users.find({
        $or: [
          { email: searchPattern },
          { phone: searchPattern },
          { name: searchPattern }
        ]
      }).toArray();
      
        res.send(usersData)
      } catch (error) {
        res.send({message: "User not found"})
      }

    })

    app.post('/manage_user', verifyToken, async (req, res) => {
      const decode = req.decoded
      if(decode.role!== 'admin'){
        return res.status(403).send({message: "unauthorized"})
      }
      const {email, role, status} = req.body
      
      try {
        if(status === 'accept'){
          let balance = 0

          if(role === 'user'){
            balance = 40
          }else if(role === 'agent'){
            balance = 10000
          }

          const res = await users.updateOne({email, role}, { $set:  {status: 'active', balance} })
          
          return res.send({message: "User Activated"})
        }
        const res = await users.updateOne({email, role}, { $set:  {status} })
        
        res.send({message: "User updated"})
      } catch (error) {
        res.send(error.message)
      }
    })

    // Post data to database for request cash in
    app.post('/request_cash_in', verifyToken, async (req, res) => {
      const {email, phone, role} = req.decoded
      const {amount} = req.body

      if(!amount){
        return res.status(400).send({message: "Missing amount"})
      }

      if(role!== 'user'){
        return res.status(402).send({message: "Must be  a user"})
      }

      try {
        const user = await users.findOne({email, phone})
        if(!user){
          return res.status(403).send({message: "User not found"})
        }

        if(user.status!== 'active'){
          return res.status(400).send({message: "User not active"})
        }

        await transaction.insertOne({
          requestName: user.name,
          requestEmail: user.email,
          requestPhone: user.phone,
          amount: Number(amount),
          type: 'cash_in',
          deducted: 0,
          date: new Date().getFullYear() + '-' + (new Date().getMonth() + 1) + '-' + new Date().getDate(),
          status: 'pending'
        })

        res.send({message: "Cash In request successful"})
      } catch (error) {
        res.send(error.message)
      }
    })


    // Post data to database for request cash out

    app.post('/request_cash_out', verifyToken, async (req, res) => {
      const {email, phone, role} = req.decoded
      const {amount, pin, agent} = req.body
      
      if(!amount){
        return res.status(400).send({message: "Missing amount"})
      }
      
      if(role!== 'user'){
        return res.status(402).send({message: "Must be  a user"})
      }
      
      try {
        const hmac = crypto.createHmac('sha256', process.env.PIN_SECRET);
        hmac.update(pin)
        const pin_hash = hmac.digest('hex');

        const user = await users.findOne({email, phone, pin: pin_hash})
        
        if(!user){
          return res.status(400).send({message: "Invalid pin"})
        }

        if(user.status!== 'active'){
          return res.status(400).send({message: "User not active"})
        }

        if(user.balance < amount){
          return res.status(400).send({message: "Insufficient balance"})
        }

        const agentInfo = await users.findOne({phone: agent, role: 'agent'})
        
        if(!agentInfo){
          return res.status(400).send({message: "Invalid number"})
        }

        if(agentInfo.status === 'active' && agentInfo.role === 'agent'){
          const res = await users.updateOne({email: agentInfo.email, phone: agentInfo.phone}, { $inc: {balance: Number(amount)}  })
        }else{
          return res.status(400).send({message: "Agent not active or not an agent"})
        }

        let deducted = 0.015 * Number(amount)

        let totalDeducted = Number(amount) - Number(deducted)

        await users.updateOne({email, phone}, { $inc: {balance: -Number(totalDeducted)}  })

        await transaction.insertOne({
          requestName: user.name,
          requestEmail: user.email,
          requestPhone: user.phone,
          amount: Number(amount),
          agent: agentInfo.phone,
          type: 'cash_out',
          deducted,
          date: new Date().getFullYear() + '-' + (new Date().getMonth() + 1) + '-' + new Date().getDate(),
          status: 'success'
        })
        res.send({message: "Cash Out request successful"})
      } catch (error) {
        res.send(error.message)
      }
    })


    // Get all cash in requests
    app.get("/cash_in_requests", verifyToken, async (req, res) => {
      const {role} = req.decoded
      
      if(role!== 'agent'){
        return res.status(403).send({message: "unauthorized"})
      }
      
      try {
        const requests = await transaction.find({ status: "pending", type: 'cash_in' }).toArray();
        res.send(requests)
      } catch (error) {
        res.send(error.message)
      }
    })

    app.post("/manage_cash_in_request", verifyToken, async (req, res) => {
      const {role, email, phone, status: agentStatus} = req.decoded
      const {id, userPhone, userEmail, status, amount, type} = req.body
      // const data = req.body

      if(role!== 'agent' || agentStatus!== 'active'){
        return res.status(403).send({message: "unauthorized"})
      }

      try {
        const result = await users.findOne({email, phone})
        
        if(!result){
          return res.status(403).send({message: "User not found"})
        }

        // Cash in management start
        if(type === 'cash_in'){
          if(result.balance < amount){
            return res.status(400).send({message: "Insufficient balance"})
          }
  
          await transaction.updateOne({ _id: new ObjectId(id), status: 'pending' }, { $set: { status: status, agent: phone } })
  
          if(status === 'accept'){
            await users.updateOne({email: userEmail, phone: userPhone}, { $inc: { balance: Number(amount) } })
            await users.updateOne({email, phone}, { $inc: { balance: -Number(amount) } })
  
            return res.send({message: "Cash in accepted"})
          }else{
            return res.send({message: "Cash in rejected"})
          }
        }
        // Cash in management end


      } catch (error) {
        res.send(error.message)
      }
    })


    app.post('/send_money', verifyToken, async (req, res) => {
      const {email, phone, role} = req.decoded
      const {amount, pin, receiver} = req.body

      if(!amount){
        return res.status(400).send({message: "Missing amount"})
      }

      if(role !== 'user'){
        return res.status(402).send({message: "Must be  a user"})
      }

      try {
        const hmac = crypto.createHmac('sha256', process.env.PIN_SECRET);
        hmac.update(pin)
        const pin_hash = hmac.digest('hex');

        const user = await users.findOne({email, phone, pin: pin_hash})

        if(!user){
          return res.status(400).send({message: "Invalid pin"})
        }

        if(user.status!== 'active'){
          return res.status(400).send({message: "User not active"})
        }
        if(amount < 50){
          return res.status(400).send({message: "Amount must be less than 50tk"})
        }

        let deducted = 0

        if(amount >= 100){
          deducted = 5
        }

        let totalDeducted = deducted + amount

        await users.updateOne({phone: receiver, role: 'user'}, {$inc : {balance: Number(amount)} })

        await users.updateOne({email : email, phone : phone, role : role}, {$inc : {balance: -Number(totalDeducted)}})

        await transaction.insertOne({
          requestName: user.name,
          requestEmail: user.email,
          requestPhone: user.phone,
          amount: Number(amount),
          receiver,
          type: 'send_money',
          deducted,
          date: new Date().getFullYear() + '-' + (new Date().getMonth() + 1) + '-' + new Date().getDate(),
          status: 'success'
        })

        res.send({message: "Send money successful"})
      } catch (error) {
        res.send(error.message)
      }
      
    })

    app.get('/transaction', verifyToken, async(req, res) => {
      const {email, phone, role} = req.decoded
      try {
        let data = 0

        if(role === "user"){
          data = 10
        }else if(role === "agent"){
          data = 20
        }
        const result = await transaction.find({requestEmail: email, requestPhone: phone}).limit(data).toArray()
        
        res.send(result)
      } catch (error) {
        return res.send(error)
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