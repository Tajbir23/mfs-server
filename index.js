require('dotenv').config();
const express =  require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const crypto = require('crypto')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createServer } = require('node:http');



const app = express();
const {Server} = require('socket.io');


const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:4173", "https://mfs-tajbir.web.app", "https://mfs-app-4e475.web.app"],
    methods: ["GET", "POST"],
    
  },
});

app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:4173", "https://mfs-tajbir.web.app"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  
}));
app.use(express.json());





const uri = "mongodb+srv://tajbir:y6mcEooEI4Is8FCb@cluster0.sdyx3bs.mongodb.net/?appName=Cluster0";
// const uri = "mongodb://localhost:27017"
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


    app.get('/', async(req, res) => {
      res.send('Hello World!')
    })

    const getSystemMonitorData = async() => {
      try {
        const totalUser = await users.countDocuments({role: 'user'})
        const totalAgent = await users.countDocuments({role: 'agent'})
        const totalTransaction = await transaction.countDocuments()
        const totalCashIn = await transaction.countDocuments({type: 'cash_in'})
        const totalCashOut = await transaction.countDocuments({type: 'cash_out'})
        const totalSendMoney = await transaction.countDocuments({type: 'send_money'})
        const totalCashInRequest = await transaction.countDocuments({type: 'cash_in', status: 'pending'})
        const totalCashOutRequest = await transaction.countDocuments({type: 'cash_out', status: 'pending'})
        
        const totalCashInAccept = await transaction.countDocuments({type: 'cash_in', status: 'accept'})
        
        const totalCashInReject = await transaction.countDocuments({type: 'cash_in', status: 'cancelled'})
        const totalCashOutReject = await transaction.countDocuments({type: 'cash_out', status: 'cancelled'})

        const totalCashOutSuccess = await transaction.countDocuments({type: 'cash_out', status: 'success'})
        const totalSendMoneySuccess = await transaction.countDocuments({type: 'send_money', status: 'success'})

        const totalAmountResult = await users.aggregate([
          {
            $group: {
              _id: null,
              balance: {$sum: "$balance"}
            }
          }]).toArray()

          const totalAmount = totalAmountResult[0].balance
          

          const totalDeductedResult = await transaction.aggregate([
            {
              $group: {
                _id: null,
                amount: {$sum: "$deducted"}
              }
            }]).toArray()
            const totalDeducted = totalDeductedResult[0].amount
          
            const data = {
              totalUser,
              totalAgent,
              totalTransaction,
              totalCashIn,
              totalCashOut,
              totalSendMoney,
              totalCashInRequest,
              totalCashOutRequest,
              totalCashInAccept,
              totalCashInReject,
              totalCashOutReject,
              totalCashOutSuccess,
              totalSendMoneySuccess,
              totalAmount,
              totalDeducted
            }
          return data

      } catch (error) {
        return error
      }
    }

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

            
            const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);

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
        res.send({ token, role: user.role });
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
      
      const data = await getSystemMonitorData();
      io.emit('system_monitoring_update', data);

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

          const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);
          
          return res.send({message: "User Activated"})
        }
        const res = await users.updateOne({email, role}, { $set:  {status} })

        const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);
        
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

        const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);

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

        const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);

        res.send({message: "Cash Out request successful"})
      } catch (error) {
        res.send(error.message)
      }
    })


    // Get all cash in requests
    app.get("/cash_in_requests", verifyToken, async (req, res) => {
      const {role} = req.decoded
      const {currentPage} = req.query

      const limit = 10
      const skip = (currentPage - 1) * limit
      
      if(role!== 'agent'){
        return res.status(403).send({message: "unauthorized"})
      }
      
      try {
        const requests = await transaction.find({ status: "pending", type: 'cash_in' }).skip(skip).limit(limit).toArray();
        const totalDocuments = await transaction.countDocuments({ status: "pending", type: 'cash_in' })
        const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);

        res.send({requests, totalDocuments})
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

            const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);
  
            return res.send({message: "Cash in accepted"})
          }else{

            const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);
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

        const data = await getSystemMonitorData();
            io.emit('system_monitoring_update', data);

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
        if(role === "user"){
          const result = await transaction.find({requestEmail: email, requestPhone: phone}).limit(data).toArray()
          return res.send({result, role})
        }else if(role === "agent"){
          const result = await transaction.find({agent: phone}).limit(data).toArray()
          return res.send({result, role})
        }
        
        
      } catch (error) {
        return res.send(error)
      }
    })



    


    app.get('/system_monitoring', verifyToken, async(req,res) => {
      const {role} = req.decoded
      if(role !== 'admin'){
        return res.status(403).send({message: "unauthorized"})
      }

      const data = await getSystemMonitorData()
      
      res.send(data)
      io.emit('system_monitoring_update', data)
    })


    app.get('/type_details/:type', verifyToken, async (req, res) => {
      const {role} = req.decoded
      const {type} = req.params
      const {currentPage} = req.query

      const limit = 10
      const skip = (parseInt(currentPage) - 1) * limit


      if(role !== "admin"){
        return res.status(403).send({message: "unauthorized"})
      }

      if(type === "users"){
        const data = await users.find({role: "user"}).skip(skip).limit(limit).toArray()
        const totalDocuments = await users.countDocuments({role: "user"})

        return res.send({data, totalDocuments})

      }else if(type === "agents"){

        const data = await users.find({role: "agent"}).skip(skip).limit(limit).toArray()
        const totalDocuments = await users.countDocuments({role: "agent"})
        return res.send({data, totalDocuments})

      }else if(type === "transactions"){

        const data = await transaction.find().skip(skip).limit(limit).toArray()
        const totalDocuments = await transaction.countDocuments()
        return res.send({data, totalDocuments})

      }else if(type === "cash_in"){

        const data = await transaction.find({type: type}).skip(skip).limit(limit).toArray()
        const totalDocuments = await transaction.countDocuments({type: type})
        return res.send({data, totalDocuments})

      }else if(type === "cash_out"){

        const data = await transaction.find({type: type}).skip(skip).limit(limit).toArray()
        const totalDocuments = await transaction.countDocuments({type: type})
        return res.send({data, totalDocuments})

      }else if(type === "send_money"){

        const data = await transaction.find({type: type}).skip(skip).limit(limit).toArray()
        const totalDocuments = await transaction.countDocuments({type: type})
        return res.send({data, totalDocuments})

      }else if(type === "cash_in_request"){

        const data = await transaction.find({type: 'cash_in', status: 'pending'}).skip(skip).limit(limit).toArray()
        const totalDocuments = await transaction.countDocuments({type: 'cash_in', status: 'pending'})
        return res.send({data, totalDocuments})

      }else if(type === 'cash_out_request'){

        const data = await transaction.find({type: 'cash_out', status: 'pending'}).skip(skip).limit(limit).toArray()
        const totalDocuments = await transaction.countDocuments({type: 'cash_out', status: 'pending'})
        return res.send({data, totalDocuments})

      }else if(type === "cash_in_accept"){

        const data = await transaction.find({type: 'cash_in', status: 'accept'}).toArray()
        const totalDocuments = await transaction.countDocuments({type: 'cash_in', status: 'accept'})
        return res.send({data, totalDocuments})

      }else if(type === "cash_out_accept"){

        const data = await transaction.find({type: 'cash_out', status: 'success'}).toArray()
        const totalDocuments = await transaction.countDocuments({type: 'cash_out', status:'success'})
        return res.send({data, totalDocuments})

      }else if(type === "cash_in_reject"){

        const data = await transaction.find({type: 'cash_in', status:'cancelled'}).toArray()
        const totalDocuments = await transaction.countDocuments({type: 'cash_in', status:'cancelled'})
        return res.send({data, totalDocuments})

      }else if(type === "cash_out_reject"){

        const data = await transaction.find({type: 'cash_out', status:'reject'}).toArray()
        const totalDocuments = await transaction.countDocuments({type: 'cash_out', status:'reject'})
        return res.send({data, totalDocuments})

      }
      
    })

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


io.on('connection', (socket)=> {
  
  console.log('connected user')
  socket.on('disconnect', () => {
    console.log('user disconnected')
  });
})

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});