(function (EXPORTS) { //btcOperator v1.0.14b
    /* BTC Crypto and API Operator */
    const btcOperator = EXPORTS;

    //This library uses API provided by chain.so (https://chain.so/)
    const URL = "https://chain.so/api/v2/";

    const fetch_api = btcOperator.fetch = function (api) {
        return new Promise((resolve, reject) => {
            console.debug(URL + api);
            fetch(URL + api).then(response => {
                response.json()
                    .then(result => result.status === "success" ? resolve(result) : reject(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    };

    const SATOSHI_IN_BTC = 1e8;

    function get_fee_rate() {
        return new Promise((resolve, reject) => {
            fetch('https://api.blockchain.info/mempool/fees').then(response => {
                if (response.ok)
                    response.json()
                        .then(result => resolve(parseFloat((result.regular / SATOSHI_IN_BTC).toFixed(8))))
                        .catch(error => reject(error));
                else
                    reject(response);
            }).catch(error => reject(error))
        })
    }

    const broadcastTx = btcOperator.broadcastTx = rawTxHex => new Promise((resolve, reject) => {
        let url = 'https://coinb.in/api/?uid=1&key=12345678901234567890123456789012&setmodule=bitcoin&request=sendrawtransaction';
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "rawtx=" + rawTxHex
        }).then(response => {
            response.text().then(resultText => {
                let r = resultText.match(/<result>.*<\/result>/);
                if (!r)
                    reject(resultText);
                else {
                    r = r.pop().replace('<result>', '').replace('</result>', '');
                    if (r == '1') {
                        let txid = resultText.match(/<txid>.*<\/txid>/).pop().replace('<txid>', '').replace('</txid>', '');
                        resolve(txid);
                    } else if (r == '0') {
                        let error = resultText.match(/<response>.*<\/response>/).pop().replace('<response>', '').replace('</response>', '');
                        reject(decodeURIComponent(error.replace(/\+/g, " ")));
                    } else reject(resultText);
                }
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    });

    Object.defineProperties(btcOperator, {
        newKeys: {
            get: () => {
                let r = coinjs.newKeys();
                r.segwitAddress = coinjs.segwitAddress(r.pubkey).address;
                r.bech32Address = coinjs.bech32Address(r.pubkey).address;
                return r;
            }
        },
        pubkey: {
            value: key => key.length >= 66 ? key : (key.length == 64 ? coinjs.newPubkey(key) : coinjs.wif2pubkey(key).pubkey)
        },
        address: {
            value: (key, prefix = undefined) => coinjs.pubkey2address(btcOperator.pubkey(key), prefix)
        },
        segwitAddress: {
            value: key => coinjs.segwitAddress(btcOperator.pubkey(key)).address
        },
        bech32Address: {
            value: key => coinjs.bech32Address(btcOperator.pubkey(key)).address
        }
    });

    coinjs.compressed = true;

    const verifyKey = btcOperator.verifyKey = function (addr, key) {
        if (!addr || !key)
            return undefined;
        switch (coinjs.addressDecode(addr).type) {
            case "standard":
                return btcOperator.address(key) === addr;
            case "multisig":
                return btcOperator.segwitAddress(key) === addr;
            case "bech32":
                return btcOperator.bech32Address(key) === addr;
            default:
                return null;
        }
    }

    const validateAddress = btcOperator.validateAddress = function (addr) {
        if (!addr)
            return undefined;
        let type = coinjs.addressDecode(addr).type;
        if (["standard", "multisig", "bech32", "multisigBech32"].includes(type))
            return type;
        else
            return false;
    }

    btcOperator.multiSigAddress = function (pubKeys, minRequired, bech32 = true) {
        if (!Array.isArray(pubKeys))
            throw "pubKeys must be an array of public keys";
        else if (pubKeys.length < minRequired)
            throw "minimum required should be less than the number of pubKeys";
        if (bech32)
            return coinjs.pubkeys2MultisigAddressBech32(pubKeys, minRequired);
        else
            return coinjs.pubkeys2MultisigAddress(pubKeys, minRequired);
    }

    //convert from one blockchain to another blockchain (target version)
    btcOperator.convert = {};

    btcOperator.convert.wif = function (source_wif, target_version = coinjs.priv) {
        let keyHex = decodeLegacy(source_wif).hex;
        if (!keyHex || keyHex.length < 66 || !/01$/.test(keyHex))
            return null;
        else
            return encodeLegacy(keyHex, target_version);
    }

    btcOperator.convert.legacy2legacy = function (source_addr, target_version = coinjs.pub) {
        let rawHex = decodeLegacy(source_addr).hex;
        if (!rawHex)
            return null;
        else
            return encodeLegacy(rawHex, target_version);
    }

    btcOperator.convert.legacy2bech = function (source_addr, target_version = coinjs.bech32.version, target_hrp = coinjs.bech32.hrp) {
        let rawHex = decodeLegacy(source_addr).hex;
        if (!rawHex)
            return null;
        else
            return encodeBech32(rawHex, target_version, target_hrp);
    }

    btcOperator.convert.bech2bech = function (source_addr, target_version = coinjs.bech32.version, target_hrp = coinjs.bech32.hrp) {
        let rawHex = decodeBech32(source_addr).hex;
        if (!rawHex)
            return null;
        else
            return encodeBech32(rawHex, target_version, target_hrp);
    }

    btcOperator.convert.bech2legacy = function (source_addr, target_version = coinjs.pub) {
        let rawHex = decodeBech32(source_addr).hex;
        if (!rawHex)
            return null;
        else
            return encodeLegacy(rawHex, target_version);
    }

    function decodeLegacy(source) {
        var decode = coinjs.base58decode(source);
        var raw = decode.slice(0, decode.length - 4),
            checksum = decode.slice(decode.length - 4);
        var hash = Crypto.SHA256(Crypto.SHA256(raw, {
            asBytes: true
        }), {
            asBytes: true
        });
        if (hash[0] != checksum[0] || hash[1] != checksum[1] || hash[2] != checksum[2] || hash[3] != checksum[3])
            return null;
        let version = raw.shift();
        return {
            version: version,
            hex: Crypto.util.bytesToHex(raw)
        }
    }

    function encodeLegacy(hex, version) {
        var bytes = Crypto.util.hexToBytes(hex);
        bytes.unshift(version);
        var hash = Crypto.SHA256(Crypto.SHA256(bytes, {
            asBytes: true
        }), {
            asBytes: true
        });
        var checksum = hash.slice(0, 4);
        return coinjs.base58encode(bytes.concat(checksum));
    }

    function decodeBech32(source) {
        let decode = coinjs.bech32_decode(source);
        if (!decode)
            return null;
        var raw = decode.data;
        let version = raw.shift();
        raw = coinjs.bech32_convert(raw, 5, 8, false);
        return {
            hrp: decode.hrp,
            version: version,
            hex: Crypto.util.bytesToHex(raw)
        }
    }

    function encodeBech32(hex, version, hrp) {
        var bytes = Crypto.util.hexToBytes(hex);
        bytes = coinjs.bech32_convert(bytes, 8, 5, true);
        bytes.unshift(version)
        return coinjs.bech32_encode(hrp, bytes);
    }

    //BTC blockchain APIs

    btcOperator.getBalance = addr => new Promise((resolve, reject) => {
        fetch_api(`get_address_balance/BTC/${addr}`)
            .then(result => resolve(parseFloat(result.data.confirmed_balance)))
            .catch(error => reject(error))
    });

    const BASE_TX_SIZE = 12,
        BASE_INPUT_SIZE = 41,
        LEGACY_INPUT_SIZE = 107,
        BECH32_INPUT_SIZE = 27,
        BECH32_MULTISIG_INPUT_SIZE = 35,
        SEGWIT_INPUT_SIZE = 59,
        MULTISIG_INPUT_SIZE_ES = 351,
        BASE_OUTPUT_SIZE = 9,
        LEGACY_OUTPUT_SIZE = 25,
        BECH32_OUTPUT_SIZE = 23,
        BECH32_MULTISIG_OUTPUT_SIZE = 34,
        SEGWIT_OUTPUT_SIZE = 23;

    function _redeemScript(addr, key) {
        let decode = coinjs.addressDecode(addr);
        switch (decode.type) {
            case "standard":
                return false;
            case "multisig":
                return key ? coinjs.segwitAddress(btcOperator.pubkey(key)).redeemscript : null;
            case "bech32":
                return decode.redeemscript;
            default:
                return null;
        }
    }

    function _sizePerInput(addr, rs) {
        switch (coinjs.addressDecode(addr).type) {
            case "standard":
                return BASE_INPUT_SIZE + LEGACY_INPUT_SIZE;
            case "bech32":
                return BASE_INPUT_SIZE + BECH32_INPUT_SIZE;
            case "multisigBech32":
                return BASE_INPUT_SIZE + BECH32_MULTISIG_INPUT_SIZE;
            case "multisig":
                switch (coinjs.script().decodeRedeemScript(rs).type) {
                    case "segwit__":
                        return BASE_INPUT_SIZE + SEGWIT_INPUT_SIZE;
                    case "multisig__":
                        return BASE_INPUT_SIZE + MULTISIG_INPUT_SIZE_ES;
                    default:
                        return null;
                };
            default:
                return null;
        }
    }

    function _sizePerOutput(addr) {
        switch (coinjs.addressDecode(addr).type) {
            case "standard":
                return BASE_OUTPUT_SIZE + LEGACY_OUTPUT_SIZE;
            case "bech32":
                return BASE_OUTPUT_SIZE + BECH32_OUTPUT_SIZE;
            case "multisigBech32":
                return BASE_OUTPUT_SIZE + BECH32_MULTISIG_OUTPUT_SIZE;
            case "multisig":
                return BASE_OUTPUT_SIZE + SEGWIT_OUTPUT_SIZE;
            default:
                return null;
        }
    }

    function validateTxParameters(parameters) {
        let invalids = [];
        //sender-ids
        if (parameters.senders) {
            if (!Array.isArray(parameters.senders))
                parameters.senders = [parameters.senders];
            parameters.senders.forEach(id => !validateAddress(id) ? invalids.push(id) : null);
            if (invalids.length)
                throw "Invalid senders:" + invalids;
        }
        if (parameters.privkeys) {
            if (!Array.isArray(parameters.privkeys))
                parameters.privkeys = [parameters.privkeys];
            if (parameters.senders.length != parameters.privkeys.length)
                throw "Array length for senders and privkeys should be equal";
            parameters.senders.forEach((id, i) => {
                let key = parameters.privkeys[i];
                if (!verifyKey(id, key)) //verify private-key
                    invalids.push(id);
                if (key.length === 64) //convert Hex to WIF if needed
                    parameters.privkeys[i] = coinjs.privkey2wif(key);
            });
            if (invalids.length)
                throw "Invalid keys:" + invalids;
        }
        //receiver-ids (and change-id)
        if (!Array.isArray(parameters.receivers))
            parameters.receivers = [parameters.receivers];
        parameters.receivers.forEach(id => !validateAddress(id) ? invalids.push(id) : null);
        if (invalids.length)
            throw "Invalid receivers:" + invalids;
        if (parameters.change_address && !validateAddress(parameters.change_address))
            throw "Invalid change_address:" + parameters.change_address;
        //fee and amounts
        if ((typeof parameters.fee !== "number" || parameters.fee <= 0) && parameters.fee !== null) //fee = null (auto calc)
            throw "Invalid fee:" + parameters.fee;
        if (!Array.isArray(parameters.amounts))
            parameters.amounts = [parameters.amounts];
        if (parameters.receivers.length != parameters.amounts.length)
            throw "Array length for receivers and amounts should be equal";
        parameters.amounts.forEach(a => typeof a !== "number" || a <= 0 ? invalids.push(a) : null);
        if (invalids.length)
            throw "Invalid amounts:" + invalids;
        //return
        return parameters;
    }

    function createTransaction(senders, redeemScripts, receivers, amounts, fee, change_address, fee_from_receiver) {
        return new Promise((resolve, reject) => {
            let total_amount = parseFloat(amounts.reduce((t, a) => t + a, 0).toFixed(8));
            const tx = coinjs.transaction();
            let output_size = addOutputs(tx, receivers, amounts, change_address);
            addInputs(tx, senders, redeemScripts, total_amount, fee, output_size, fee_from_receiver).then(result => {
                if (result.change_amount > 0 && result.change_amount > result.fee) //add change amount if any (ignore dust change)
                    tx.outs[tx.outs.length - 1].value = parseInt(result.change_amount * SATOSHI_IN_BTC); //values are in satoshi
                if (fee_from_receiver) { //deduce fee from receivers if fee_from_receiver
                    let fee_remaining = parseInt(result.fee * SATOSHI_IN_BTC);
                    for (let i = 0; i < tx.outs.length - 1 && fee_remaining > 0; i++) {
                        if (fee_remaining < tx.outs[i].value) {
                            tx.outs[i].value -= fee_remaining;
                            fee_remaining = 0;
                        } else {
                            fee_remaining -= tx.outs[i].value;
                            tx.outs[i].value = 0;
                        }
                    }
                    if (fee_remaining > 0)
                        return reject("Send amount is less than fee");

                }
                tx.outs = tx.outs.filter(o => o.value != 0); //remove all output with value 0
                result.output_size = output_size;
                result.output_amount = total_amount - (fee_from_receiver ? result.fee : 0);
                result.total_size = BASE_TX_SIZE + output_size + result.input_size;
                result.transaction = tx;
                resolve(result);
            }).catch(error => reject(error))
        })
    }

    function addInputs(tx, senders, redeemScripts, total_amount, fee, output_size, fee_from_receiver) {
        return new Promise((resolve, reject) => {
            if (fee !== null) {
                addUTXOs(tx, senders, redeemScripts, fee_from_receiver ? total_amount : total_amount + fee, false).then(result => {
                    result.fee = fee;
                    resolve(result);
                }).catch(error => reject(error))
            } else {
                get_fee_rate().then(fee_rate => {
                    let net_fee = BASE_TX_SIZE * fee_rate;
                    net_fee += (output_size * fee_rate);
                    (fee_from_receiver ?
                        addUTXOs(tx, senders, redeemScripts, total_amount, false) :
                        addUTXOs(tx, senders, redeemScripts, total_amount + net_fee, fee_rate)
                    ).then(result => {
                        result.fee = parseFloat((net_fee + (result.input_size * fee_rate)).toFixed(8));
                        result.fee_rate = fee_rate;
                        resolve(result);
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            }
        })
    }

    function addUTXOs(tx, senders, redeemScripts, required_amount, fee_rate, rec_args = {}) {
        return new Promise((resolve, reject) => {
            required_amount = parseFloat(required_amount.toFixed(8));
            if (typeof rec_args.n === "undefined") {
                rec_args.n = 0;
                rec_args.input_size = 0;
                rec_args.input_amount = 0;
            }
            if (required_amount <= 0)
                return resolve({
                    input_size: rec_args.input_size,
                    input_amount: rec_args.input_amount,
                    change_amount: required_amount * -1 //required_amount will be -ve of change_amount
                });
            else if (rec_args.n >= senders.length)
                return reject("Insufficient Balance");
            let addr = senders[rec_args.n],
                rs = redeemScripts[rec_args.n];
            let addr_type = coinjs.addressDecode(addr).type;
            let size_per_input = _sizePerInput(addr, rs);
            fetch_api(`get_tx_unspent/BTC/${addr}`).then(result => {
                let utxos = result.data.txs;
                console.debug("add-utxo", addr, rs, required_amount, utxos);
                for (let i = 0; i < utxos.length && required_amount > 0; i++) {
                    if (!utxos[i].confirmations) //ignore unconfirmed utxo
                        continue;
                    var script;
                    if (!rs || !rs.length) //legacy script
                        script = utxos[i].script_hex;
                    else if (((rs.match(/^00/) && rs.length == 44)) || (rs.length == 40 && rs.match(/^[a-f0-9]+$/gi)) || addr_type === 'multisigBech32') {
                        //redeemScript for segwit/bech32 and multisig (bech32)
                        let s = coinjs.script();
                        s.writeBytes(Crypto.util.hexToBytes(rs));
                        s.writeOp(0);
                        s.writeBytes(coinjs.numToBytes((utxos[i].value * SATOSHI_IN_BTC).toFixed(0), 8));
                        script = Crypto.util.bytesToHex(s.buffer);
                    } else //redeemScript for multisig (segwit)
                        script = rs;
                    tx.addinput(utxos[i].txid, utxos[i].output_no, script, 0xfffffffd /*sequence*/); //0xfffffffd for Replace-by-fee
                    //update track values
                    rec_args.input_size += size_per_input;
                    rec_args.input_amount += parseFloat(utxos[i].value);
                    required_amount -= parseFloat(utxos[i].value);
                    if (fee_rate) //automatic fee calculation (dynamic)
                        required_amount += size_per_input * fee_rate;
                }
                rec_args.n += 1;
                addUTXOs(tx, senders, redeemScripts, required_amount, fee_rate, rec_args)
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    function addOutputs(tx, receivers, amounts, change_address) {
        let size = 0;
        for (let i in receivers) {
            tx.addoutput(receivers[i], amounts[i]);
            size += _sizePerOutput(receivers[i]);
        }
        tx.addoutput(change_address, 0);
        size += _sizePerOutput(change_address);
        return size;
    }

    /*
    function autoFeeCalc(tx) {
        return new Promise((resolve, reject) => {
            get_fee_rate().then(fee_rate => {
                let tx_size = tx.size();
                for (var i = 0; i < this.ins.length; i++)
                    switch (tx.extractScriptKey(i).type) {
                        case 'scriptpubkey':
                            tx_size += SIGN_SIZE;
                            break;
                        case 'segwit':
                        case 'multisig':
                            tx_size += SIGN_SIZE * 0.25;
                            break;
                        default:
                            console.warn('Unknown script-type');
                            tx_size += SIGN_SIZE;
                    }
                resolve(tx_size * fee_rate);
            }).catch(error => reject(error))
        })
    }

    function editFee(tx, current_fee, target_fee, index = -1) {
        //values are in satoshi
        index = parseInt(index >= 0 ? index : tx.outs.length - index);
        if (index < 0 || index >= tx.outs.length)
            throw "Invalid index";
        let edit_value = parseInt(current_fee - target_fee), //rip of any decimal places
            current_value = tx.outs[index].value; //could be BigInterger
        if (edit_value < 0 && edit_value > current_value)
            throw "Insufficient value at vout";
        tx.outs[index].value = current_value instanceof BigInteger ?
            current_value.add(new BigInteger('' + edit_value)) : parseInt(current_value + edit_value);
    }
    */

    btcOperator.sendTx = function (senders, privkeys, receivers, amounts, fee = null, options = {}) {
        return new Promise((resolve, reject) => {
            createSignedTx(senders, privkeys, receivers, amounts, fee, options).then(result => {
                debugger;
                broadcastTx(result.transaction.serialize())
                    .then(txid => resolve(txid))
                    .catch(error => reject(error));
            }).catch(error => reject(error))
        })
    }

    const createSignedTx = btcOperator.createSignedTx = function (senders, privkeys, receivers, amounts, fee = null, options = {}) {
        return new Promise((resolve, reject) => {
            try {
                ({
                    senders,
                    privkeys,
                    receivers,
                    amounts
                } = validateTxParameters({
                    senders,
                    privkeys,
                    receivers,
                    amounts,
                    fee,
                    change_address: options.change_address
                }));
            } catch (e) {
                return reject(e)
            }
            let redeemScripts = [],
                wif_keys = [];
            for (let i in senders) {
                let rs = _redeemScript(senders[i], privkeys[i]); //get redeem-script (segwit/bech32)
                redeemScripts.push(rs);
                rs === false ? wif_keys.unshift(privkeys[i]) : wif_keys.push(privkeys[i]); //sorting private-keys (wif)
            }
            if (redeemScripts.includes(null)) //TODO: segwit
                return reject("Unable to get redeem-script");
            //create transaction
            createTransaction(senders, redeemScripts, receivers, amounts, fee, options.change_address || senders[0], options.fee_from_receiver).then(result => {
                let tx = result.transaction;
                console.debug("Unsigned:", tx.serialize());
                new Set(wif_keys).forEach(key => console.debug("Signing key:", key, tx.sign(key, 1 /*sighashtype*/))); //Sign the tx using private key WIF
                console.debug("Signed:", tx.serialize());
                resolve(result);
            }).catch(error => reject(error));
        })
    }

    btcOperator.createTx = function (senders, receivers, amounts, fee = null, options = {}) {
        return new Promise((resolve, reject) => {
            try {
                ({
                    senders,
                    receivers,
                    amounts
                } = validateTxParameters({
                    senders,
                    receivers,
                    amounts,
                    fee,
                    change_address: options.change_address
                }));
            } catch (e) {
                return reject(e)
            }
            let redeemScripts = senders.map(id => _redeemScript(id));
            if (redeemScripts.includes(null)) //TODO: segwit
                return reject("Unable to get redeem-script");
            //create transaction
            createTransaction(senders, redeemScripts, receivers, amounts, fee, options.change_address || senders[0], options.fee_from_receiver).then(result => {
                result.tx_hex = result.transaction.serialize();
                delete result.transaction;
                resolve(result);
            }).catch(error => reject(error))
        })
    }

    btcOperator.createMultiSigTx = function (sender, redeemScript, receivers, amounts, fee = null, options = {}) {
        return new Promise((resolve, reject) => {
            //validate tx parameters
            let addr_type = validateAddress(sender);
            if (!(["multisig", "multisigBech32"].includes(addr_type)))
                return reject("Invalid sender (multisig):" + sender);
            else {
                let script = coinjs.script();
                let decode = (addr_type == "multisig") ?
                    script.decodeRedeemScript(redeemScript) :
                    script.decodeRedeemScriptBech32(redeemScript);
                if (!decode || decode.address !== sender)
                    return reject("Invalid redeem-script");
            }
            try {
                ({
                    receivers,
                    amounts
                } = validateTxParameters({
                    receivers,
                    amounts,
                    fee,
                    change_address: options.change_address
                }));
            } catch (e) {
                return reject(e)
            }
            //create transaction
            createTransaction([sender], [redeemScript], receivers, amounts, fee, options.change_address || sender, options.fee_from_receiver).then(result => {
                result.tx_hex = result.transaction.serialize();
                delete result.transaction;
                resolve(result);
            }).catch(error => reject(error))

        })
    }

    function deserializeTx(tx) {
        if (typeof tx === 'string' || Array.isArray(tx)) {
            try {
                tx = coinjs.transaction().deserialize(tx);
            } catch {
                throw "Invalid transaction hex";
            }
        } else if (typeof tx !== 'object' || typeof tx.sign !== 'function')
            throw "Invalid transaction object";
        return tx;
    }

    btcOperator.signTx = function (tx, privkeys, sighashtype = 1) {
        tx = deserializeTx(tx);
        if (!Array.isArray(privkeys))
            privkeys = [privkeys];
        for (let i in privkeys)
            if (privkeys[i].length === 64)
                privkeys[i] = coinjs.privkey2wif(privkeys[i]);
        new Set(privkeys).forEach(key => tx.sign(key, sighashtype)); //Sign the tx using private key WIF
        return tx.serialize();
    }

    const checkSigned = btcOperator.checkSigned = function (tx, bool = true) {
        tx = deserializeTx(tx);
        let n = [];
        for (let i in tx.ins) {
            var s = tx.extractScriptKey(i);
            if (s['type'] !== 'multisig' && s['type'] !== 'multisig_bech32')
                n.push(s.signed == 'true' || (tx.witness[i] && tx.witness[i].length == 2))
            else {
                var rs = coinjs.script().decodeRedeemScript(s.script);  //will work for bech32 too, as only address is diff
                let x = {
                    s: s['signatures'],
                    r: rs['signaturesRequired'],
                    t: rs['pubkeys'].length
                };
                if (x.r > x.t)
                    throw "signaturesRequired is more than publicKeys";
                else if (x.s < x.r)
                    n.push(x);
                else
                    n.push(true);
            }
        }
        return bool ? !(n.filter(x => x !== true).length) : n;
    }

    btcOperator.checkIfSameTx = function (tx1, tx2) {
        tx1 = deserializeTx(tx1);
        tx2 = deserializeTx(tx2);
        if (tx1.ins.length !== tx2.ins.length || tx1.outs.length !== tx2.outs.length)
            return false;
        for (let i = 0; i < tx1.ins.length; i++)
            if (tx1.ins[i].outpoint.hash !== tx2.ins[i].outpoint.hash || tx1.ins[i].outpoint.index !== tx2.ins[i].outpoint.index)
                return false;
        for (let i = 0; i < tx2.ins.length; i++)
            if (tx1.outs[i].value !== tx2.outs[i].value || Crypto.util.bytesToHex(tx1.outs[i].script.buffer) !== Crypto.util.bytesToHex(tx2.outs[i].script.buffer))
                return false;
        return true;
    }

    const getTxOutput = (txid, i) => new Promise((resolve, reject) => {
        fetch_api(`get_tx_outputs/BTC/${txid}/${i}`)
            .then(result => resolve(result.data.outputs))
            .catch(error => reject(error))
    });

    btcOperator.parseTransaction = function (tx) {
        return new Promise((resolve, reject) => {
            tx = deserializeTx(tx);
            let result = {};
            let promises = [];
            //Parse Inputs
            for (let i = 0; i < tx.ins.length; i++)
                promises.push(getTxOutput(tx.ins[i].outpoint.hash, tx.ins[i].outpoint.index));
            Promise.all(promises).then(inputs => {
                result.inputs = inputs.map(inp => Object({
                    address: inp.address,
                    value: parseFloat(inp.value)
                }));
                let signed = checkSigned(tx, false);
                result.inputs.forEach((inp, i) => inp.signed = signed[i]);
                //Parse Outputs
                result.outputs = tx.outs.map(out => {
                    var address;
                    switch (out.script.chunks[0]) {
                        case 0: //bech32, multisig-bech32
                            address = encodeBech32(Crypto.util.bytesToHex(out.script.chunks[1]), coinjs.bech32.version, coinjs.bech32.hrp);
                            break;
                        case 169: //segwit, multisig-segwit
                            address = encodeLegacy(Crypto.util.bytesToHex(out.script.chunks[1]), coinjs.multisig);
                            break;
                        case 118: //legacy
                            address = encodeLegacy(Crypto.util.bytesToHex(out.script.chunks[2]), coinjs.pub);
                    }
                    return {
                        address,
                        value: parseFloat(out.value / SATOSHI_IN_BTC)
                    }
                });
                //Parse Totals
                result.total_input = parseFloat(result.inputs.reduce((a, inp) => a += inp.value, 0).toFixed(8));
                result.total_output = parseFloat(result.outputs.reduce((a, out) => a += out.value, 0).toFixed(8));
                result.fee = parseFloat((result.total_input - result.total_output).toFixed(8));
                resolve(result);
            }).catch(error => reject(error))
        })
    }

    btcOperator.transactionID = function (tx) {
        tx = deserializeTx(tx);
        let clone = coinjs.clone(tx);
        clone.witness = null;
        let raw_bytes = Crypto.util.hexToBytes(clone.serialize());
        let txid = Crypto.SHA256(Crypto.SHA256(raw_bytes, { asBytes: true }), { asBytes: true }).reverse();
        return Crypto.util.bytesToHex(txid);
    }

    btcOperator.getTx = txid => new Promise((resolve, reject) => {
        fetch_api(`get_tx/BTC/${txid}`)
            .then(result => resolve(result.data))
            .catch(error => reject(error))
    });

    btcOperator.getAddressData = addr => new Promise((resolve, reject) => {
        fetch_api(`address/BTC/${addr}`)
            .then(result => resolve(result.data))
            .catch(error => reject(error))
    });

    btcOperator.getBlock = block => new Promise((resolve, reject) => {
        fetch_api(`get_block/BTC/${block}`)
            .then(result => resolve(result.data))
            .catch(error => reject(error))
    });

})('object' === typeof module ? module.exports : window.btcOperator = {});