import bodyParser from "body-parser";
import express from "express";
import { BASE_USER_PORT , REGISTRY_PORT, BASE_ONION_ROUTER_PORT} from "../config";
import {
  createRandomSymmetricKey,
  exportSymKey,
  symEncrypt,
  rsaEncrypt,
} from "../crypto";
import axios from "axios";

export type SendMessageBody = {
  message: string;
  destinationUserId: number;
};

type Node = {
  nodeId: number;
  pubKey: string;
};

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  let lastReceivedMessage: string | null = null;
  let lastSentMessage: string | null = null;
  let lastCircuit: number[] | null = null;

  // TODO implement the status route
  // _user.get("/status", (req, res) => {});
  _user.get("/status", (req, res) => {
    res.send("live");
  });

  _user.get("/getLastReceivedMessage", (req, res) => {
    res.json({ result: lastReceivedMessage });
  });

  
  _user.get("/getLastSentMessage", (req, res) => {
    res.json({ result: lastSentMessage });
  });

  _user.post("/message", (req, res) => {
    const { message } = req.body as SendMessageBody;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    lastReceivedMessage = message;
    return res.send("success");
  });

  _user.get("/getLastCircuit", (req, res) => {
    return res.json({ result: lastCircuit });
  });

  _user.post("/sendMessage", async (req, res) => {
    const { message, destinationUserId } = req.body;
    if (!message || destinationUserId === undefined) {
      return res.status(400).json({ error: "A message and destination id are required" });
    }

    try {
      const { data } = await axios.get<{ nodes: Node[] }>( `http://localhost:${REGISTRY_PORT}/getNodeRegistry`);
      
      if (data.nodes.length < 3) {
        return res.status(500).json({ error: "There are not enough nodes registered" });
      }

      const selectedNodes: Node[] = [];
      while (selectedNodes.length < 3) {
        const randomIndex = Math.floor(Math.random() * data.nodes.length);
        const randomNode = data.nodes[randomIndex];
        if (!selectedNodes.includes(randomNode)) {
          selectedNodes.push(randomNode);
        }
      }

      lastCircuit = selectedNodes.map(node => node.nodeId);

      const symmetricKeys = await Promise.all(selectedNodes.map(() => createRandomSymmetricKey()));

      let encryptedMessage = message;
      let previousDestination = (BASE_USER_PORT + destinationUserId).toString().padStart(10, '0');

      for (let i = selectedNodes.length - 1; i >= 0; i--) {
        const symmetricKey = symmetricKeys[i];
        const symmetricKeyString = await exportSymKey(symmetricKey);

        const combinedData = previousDestination + encryptedMessage;
        encryptedMessage = await symEncrypt(symmetricKey, combinedData);

        const nodePublicKey = selectedNodes[i].pubKey;
        const encryptedSymmetricKey = await rsaEncrypt(symmetricKeyString, nodePublicKey);

        encryptedMessage = encryptedSymmetricKey + encryptedMessage;

        previousDestination = (BASE_ONION_ROUTER_PORT + selectedNodes[i].nodeId).toString().padStart(10, '0');
      }

      await axios.post(`http://localhost:${BASE_ONION_ROUTER_PORT + selectedNodes[0].nodeId}/message`, {
        message: encryptedMessage,
      });

      lastSentMessage = message;
      return res.json({ success: true });

    } catch (error) {
      console.error("Error sending message:", error);
      return res.status(500).json({ error: "Failed to send message" });
    }
  });
  

  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(
      `User ${userId} is listening on port ${BASE_USER_PORT + userId}`
    );
  });

  return server;
}
