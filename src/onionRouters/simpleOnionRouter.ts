import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT, BASE_USER_PORT } from "../config";
import { generateRsaKeyPair, exportPrvKey, exportPubKey, importPrvKey, rsaDecrypt, symDecrypt, importSymKey } from "../crypto";
import axios from "axios";

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  let lastReceivedEncryptedMessage: string | null = null;
  let lastReceivedDecryptedMessage: string | null = null;
  let lastMessageDestination: number | null = null;
  let circuit: number[] = [];

  const keyPair = await generateRsaKeyPair();
  const privateKey = keyPair.privateKey;
  const publicKey = keyPair.publicKey;
  const pubKeyString = await exportPubKey(publicKey);
  

  try {
    await axios.post(`http://localhost:${REGISTRY_PORT}/registerNode`, {
      nodeId,
      pubKey: pubKeyString,
    });
    console.log(`Node ${nodeId} registered successfully.`);
  } catch (error) {
    console.error(`Failed to register node ${nodeId}:`, error);
  }

  onionRouter.get("/getPrivateKey", async (req, res) => {
    try {
      const privateKeyString = await exportPrvKey(privateKey);
      if (!privateKeyString) {
        return res.status(500).json({ error: "Failed to export private key" });
      }
      return res.json({ result: privateKeyString });
    } catch (err) {
      return res.status(500).json({ error: "Error exporting private key" });
    }
  });

  // TODO implement the status route
  // onionRouter.get("/status", (req, res) => {});
  onionRouter.get("/status", (req, res) => {
    res.send("live");
  });

  onionRouter.get("/getLastReceivedEncryptedMessage", (req, res) => {
    res.json({ result: lastReceivedEncryptedMessage });
  });

  onionRouter.get("/getLastReceivedDecryptedMessage", (req, res) => {
    res.json({ result: lastReceivedDecryptedMessage });
  });

  onionRouter.get("/getLastMessageDestination", (req, res) => {
    res.json({ result: lastMessageDestination });
  });

  
  onionRouter.post("/message", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "A message is required" });
      }

      lastReceivedEncryptedMessage = message;
      console.log(`Node ${nodeId} received encrypted message: ${lastReceivedEncryptedMessage}`);

      const encryptedSymKey = message.slice(0, 344);
      const encryptedMessage = message.slice(344);
      console.log(`Node ${nodeId} encrypted symmetric key: ${encryptedSymKey}`);
      console.log(`Node ${nodeId} encrypted message part: ${encryptedMessage}`);

      const symKeyString = await rsaDecrypt(encryptedSymKey, privateKey);
      console.log(`Node ${nodeId} decrypted symmetric key: ${symKeyString}`);

      const decryptedMessage = await symDecrypt(symKeyString, encryptedMessage);
      console.log(`Node ${nodeId} decrypted message: ${decryptedMessage}`);

      lastReceivedDecryptedMessage = decryptedMessage.slice(10);
      lastMessageDestination = parseInt(decryptedMessage.slice(0, 10), 10);
      console.log(`Node ${nodeId} decrypted message: ${lastReceivedDecryptedMessage}`);
      console.log(`Node ${nodeId} forwarding to: ${lastMessageDestination}`);

      await axios.post(`http://localhost:${lastMessageDestination}/message`, { message: lastReceivedDecryptedMessage });
      
      return res.json({ message: "Message forwarded" });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error when processing the message" });
    }
  });
  

  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
      `Onion router ${nodeId} is listening on port ${
        BASE_ONION_ROUTER_PORT + nodeId
      }`
    );
  });

  return server;
}
