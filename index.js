var express = require("express");
var app = express();

require('./set_globals');
require('./lib');
global.floCrypto=require('./floCrypto');

app.get("/", (req, res, next) => {
    res.json(["Tony","Lisa","Michael","Ginger","Food"]);
});

app.get("/hash", (req, res, next) => {
    var data = req.query.data;
    r = Crypto.util.wordsToBytes(data)
    r= Crypto.SHA256(r, {asBytes:true})
    r= Crypto.SHA256(r, {asBytes:true})
    r.reverse()
    r= Crypto.util.bytesToHex(r)
    res.json(r);
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});