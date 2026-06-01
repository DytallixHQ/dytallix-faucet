const winston = require("winston");
const axios = require("axios");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { logFaucetEvent } = require("../utils/artifactLogger");

const execFileAsync = promisify(execFile);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

class DualTokenFaucetController {
  constructor() {
    this.rpcEndpoint = process.env.RPC_ENDPOINT || "http://127.0.0.1:3030";
    this.chainId = process.env.CHAIN_ID || "dyt-local-1";
    this.faucetAddress = process.env.FAUCET_ADDRESS || "dyt1faucet";
    // Faucet dispenses DRT (the fee/reward token) via signed transfers from a
    // funded treasury wallet, using the dytallix CLI. No admin mint endpoint.
    this.faucetWallet = process.env.FAUCET_WALLET || "faucet-hot";
    this.dytallixBin = process.env.DYTALLIX_BIN || "dytallix";

    // Dual token system configuration
    this.tokenConfig = {
      DGT: {
        amount: process.env.DGT_FAUCET_AMOUNT || "10000000udgt",
        denom: "udgt",
        name: "Dytallix Governance Token",
        description: "For governance voting and protocol decisions",
        maxBalance: 50000000,
        supply: "Fixed (1B DGT)",
        votingPower: "1 DGT = 1 Vote",
        perRequest: "10 DGT",
      },
      DRT: {
        amount: process.env.DRT_FAUCET_AMOUNT || "100000000udrt",
        denom: "udrt",
        name: "Dytallix Reward Token",
        description: "For rewards, incentives, and transaction fees",
        maxBalance: 500000000,
        supply: "Inflationary (~6% annual)",
        utility: "Staking rewards, AI payments, transaction fees",
        perRequest: "100 DRT",
      },
    };
  }

  async sendTokens(req, res) {
    try {
      const { address, tokenType = "both" } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      logger.info("Dual token faucet request received", {
        address,
        tokenType,
        clientIp,
      });

      // Validate address format
      if (!this.isValidAddress(address)) {
        return res.status(400).json({
          error: "Invalid address format",
          message: "Address must be a valid Dytallix address starting with dyt or dytallix",
        });
      }

      // DGT is a fixed-supply (1B) governance token allocated at genesis — it is
      // NOT dispensed by the faucet. The faucet dispenses DRT, the reward/fee
      // token users need to pay transaction fees.
      if (tokenType === "DGT") {
        return res.status(400).json({
          error: "DGT not available from faucet",
          message:
            "DGT is a fixed-supply governance token distributed at genesis, not via the faucet. Request DRT (the fee/reward token) instead.",
        });
      }

      const udrt = parseInt(this.tokenConfig.DRT.amount);
      const drtWhole = Math.floor(udrt / 1000000);

      // Dispense by signing a normal transfer from the faucet treasury wallet via
      // the dytallix CLI (no privileged mint endpoint). DYTALLIX_ENDPOINT points
      // the CLI at the local node; --from selects the faucet wallet.
      let cliOut = "";
      try {
        const result = await execFileAsync(
          this.dytallixBin,
          ["send", address, String(drtWhole), "--token", "drt", "--from", this.faucetWallet],
          {
            env: { ...process.env, DYTALLIX_ENDPOINT: this.rpcEndpoint },
            timeout: 30000,
          }
        );
        cliOut = `${result.stdout || ""}${result.stderr || ""}`;
      } catch (cliErr) {
        const detail =
          `${cliErr.stdout || ""}${cliErr.stderr || ""}`.trim() || cliErr.message;
        logger.error("Faucet DRT transfer failed", { address, detail });
        return res.status(502).json({
          error: "Faucet transfer failed",
          message: "Unable to dispense DRT right now. Please try again later.",
        });
      }

      // Best-effort extraction of the transaction hash from CLI output.
      const hashMatch = cliOut.match(/(0x)?[0-9a-f]{32,}/i);
      const txHash = hashMatch ? hashMatch[0] : null;

      logger.info("Faucet dispensed DRT via signed transfer", { address, txHash });

      const transactions = [
        {
          token: "DRT",
          amount: `${udrt}udrt`,
          amountFormatted: `${drtWhole} DRT`,
          txHash,
          denom: "udrt",
          purpose: "Rewards, incentives, and transaction fees",
        },
      ];
      const totalSent = { DRT: `${udrt}udrt` };

      logFaucetEvent("SUCCESS_FUND", {
        address,
        tokenType: "DRT",
        totalSent,
        transactions,
      });

      res.status(200).json({
        success: true,
        message: `Successfully sent DRT to ${address}`,
        recipient: address,
        tokenType: "DRT",
        transactions,
        totalSent,
        txHash,
        timestamp: new Date().toISOString(),
        note: this.getTokenTypeNote("DRT"),
      });
    } catch (error) {
      logger.error("Error in dual token distribution", {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        error: "Blockchain error",
        message: error.message || "Failed to send tokens. Please try again later.",
      });
    }
  }

  getTokenTypeNote(tokenType) {
    switch (tokenType) {
      case "DGT":
        return "Received DGT tokens for governance voting.";
      case "DRT":
        return "Received DRT tokens for rewards and transactions.";
      case "both":
        return "Received both DGT (governance) and DRT (rewards) tokens.";
      default:
        return "Token distribution completed.";
    }
  }

  async getStatus(req, res) {
    try {
      // Check blockchain connection
      let networkStatus = { connected: false, error: null };
      try {
        const response = await axios.get(`${this.rpcEndpoint}/status`);
        networkStatus = {
          connected: true,
          chainId: response.data.chain_id,
          latestHeight: response.data.latest_height,
          syncing: response.data.syncing,
        };
      } catch (err) {
        networkStatus.error = err.message;
      }

      res.json({
        status: networkStatus.connected ? "healthy" : "degraded",
        faucetAddress: this.faucetAddress,
        chainId: this.chainId,
        network: networkStatus,
        tokenomics: {
          DGT: this.tokenConfig.DGT,
          DRT: this.tokenConfig.DRT,
        },
        supportedTokenTypes: ["DGT", "DRT", "both"],
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getBalance(req, res) {
    try {
      const { address } = req.params;
      // Validate before interpolating into the RPC URL so a caller cannot inject
      // path segments (e.g. "../") and reach unintended backend endpoints.
      if (!this.isValidAddress(address)) {
        return res.status(400).json({ error: "Invalid address format" });
      }
      const response = await axios.get(
        `${this.rpcEndpoint}/balance/${encodeURIComponent(address)}`
      );
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getAddressBalance(address, denom) {
    try {
      const response = await axios.get(`${this.rpcEndpoint}/balance/${address}`);
      const balances = response.data.balances || {};
      const bal = balances[denom];
      return bal?.balance ? parseInt(bal.balance) : 0;
    } catch {
      return 0;
    }
  }

  isValidAddress(address) {
    if (typeof address !== "string") {
      return false;
    }

    return /^(dyt1|dytallix1)[a-z0-9]{20,120}$/.test(address);
  }

  generateTxHash() {
    const chars = "0123456789ABCDEF";
    let hash = "";
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * 16)];
    }
    return hash;
  }
}

module.exports = new DualTokenFaucetController();
