(function (EXPORTS) {
  "use strict";
  const tonCrypto = EXPORTS;

  const nacl = window.nacl;
  const TonWeb = window.TonWeb;

  // Helpers
  const generateNewID = (tonCrypto.generateNewID = function () {
    var key = new Bitcoin.ECKey(false);
    key.setCompressed(true);
    return {
      floID: key.getBitcoinAddress(),
      pubKey: key.getPubKeyHex(),
      privKey: key.getBitcoinWalletImportFormat(),
    };
  });

  Object.defineProperties(tonCrypto, {
    newID: {
      get: () => generateNewID(),
    },
    hashID: {
      value: (str) => {
        let bytes = ripemd160(Crypto.SHA256(str, { asBytes: true }), {
          asBytes: true,
        });
        bytes.unshift(bitjs.pub);
        var hash = Crypto.SHA256(
          Crypto.SHA256(bytes, {
            asBytes: true,
          }),
          {
            asBytes: true,
          }
        );
        var checksum = hash.slice(0, 4);
        return bitjs.Base58.encode(bytes.concat(checksum));
      },
    },
    tmpID: {
      get: () => {
        let bytes = Crypto.util.randomBytes(20);
        bytes.unshift(bitjs.pub);
        var hash = Crypto.SHA256(
          Crypto.SHA256(bytes, {
            asBytes: true,
          }),
          {
            asBytes: true,
          }
        );
        var checksum = hash.slice(0, 4);
        return bitjs.Base58.encode(bytes.concat(checksum));
      },
    },
  });
  function hexToBytes(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return new Uint8Array(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  }
  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  function sha256Hex(hexString) {
    return Crypto.SHA256(Crypto.util.hexToBytes(hexString));
  }

  // ---- Multi-chain (FLO, BTC, TON) ----
  tonCrypto.generateMultiChain = async function (inputWif) {
    const origBitjsPub = bitjs.pub;
    const origBitjsPriv = bitjs.priv;
    const origBitjsCompressed = bitjs.compressed;
    const origCoinJsCompressed = coinjs.compressed;

    bitjs.compressed = true;
    coinjs.compressed = true;

    const versions = {
      BTC: { pub: 0x00, priv: 0x80 },
      FLO: { pub: 0x23, priv: 0xa3 },
    };

    let privKeyHex;
    let compressed = true;

    if (typeof inputWif === "string" && inputWif.length > 0) {
      const hexOnly = /^[0-9a-fA-F]+$/.test(inputWif.trim());

      if (hexOnly && (inputWif.length === 64 || inputWif.length === 128)) {
        // Raw hex private key input
        if (inputWif.length === 128) {
          privKeyHex = inputWif.substring(0, 64);
        } else {
          privKeyHex = inputWif;
        }
        compressed = true;
      } else {
        // WIF format input
        try {
          const decode = Bitcoin.Base58.decode(inputWif);
          const keyWithVersion = decode.slice(0, decode.length - 4);
          let key = keyWithVersion.slice(1);

          if (key.length >= 33 && key[key.length - 1] === 0x01) {
            key = key.slice(0, key.length - 1);
            compressed = true;
          } else {
            compressed = false;
          }

          privKeyHex = Crypto.util.bytesToHex(key);
        } catch (e) {
          console.warn("Invalid WIF format, treating as seed:", e);
        }
      }
    } else {
      const newKey = generateNewID();
      const decode = Bitcoin.Base58.decode(newKey.privKey);
      const keyWithVersion = decode.slice(0, decode.length - 4);
      let key = keyWithVersion.slice(1);

      if (key.length >= 33 && key[key.length - 1] === 0x01) {
        key = key.slice(0, key.length - 1);
      }

      privKeyHex = Crypto.util.bytesToHex(key);
    }

    bitjs.compressed = compressed;
    coinjs.compressed = compressed;

    // Generate public key
    const pubKey = bitjs.newPubkey(privKeyHex);

    const result = {
      BTC: { address: "", privateKey: "" },
      FLO: { address: "", privateKey: "" },
    };

    // For BTC
    bitjs.pub = versions.BTC.pub;
    bitjs.priv = versions.BTC.priv;
    result.BTC.address = coinjs.bech32Address(pubKey).address;
    result.BTC.privateKey = bitjs.privkey2wif(privKeyHex);

    // For FLO
    bitjs.pub = versions.FLO.pub;
    bitjs.priv = versions.FLO.priv;
    result.FLO.address = bitjs.pubkey2address(pubKey);
    result.FLO.privateKey = bitjs.privkey2wif(privKeyHex);

    bitjs.pub = origBitjsPub;
    bitjs.priv = origBitjsPriv;
    bitjs.compressed = origBitjsCompressed;
    coinjs.compressed = origCoinJsCompressed;
    // For TON
    let tonSeed;
    if (privKeyHex.length === 64) {
      tonSeed = Crypto.util.hexToBytes(privKeyHex);
    } else {
      const padded = privKeyHex.padEnd(64, "0").substring(0, 64);
      tonSeed = Crypto.util.hexToBytes(padded);
    }
    const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(tonSeed));

    let tonAddr;
    try {
      let WalletClass = null;
      let tonweb = null;

      tonweb = new TonWeb();

      if (TonWeb.Wallets.all.v4R2) {
        WalletClass = TonWeb.Wallets.all.v4R2;
        console.log("Using TonWeb.Wallets.all.v4R2");
      }

      if (WalletClass && tonweb) {
        const wallet = new WalletClass(tonweb.provider, {
          publicKey: kp.publicKey,
        });
        const realAddr = await wallet.getAddress();
        tonAddr = realAddr.toString(true, true, false);
      }
    } catch (e) {
      console.warn("TonWeb error, using fallback:", e);
    }

    result.TON = {
      address: tonAddr,
      privateKey: bytesToHex(kp.secretKey),
    };
    return result;
  };

  // ---- Recover ----
  tonCrypto.recoverFromInput = async function (input) {
    const trimmed = input.trim();
    return await tonCrypto.generateMultiChain(trimmed);
  };
})("object" === typeof module ? module.exports : (window.tonCrypto = {}));
