import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import protect from "../middleware/authMiddleware.js";
import createUserWithPersonalWorkspace from "../utils/createUserWithPersonalWorkspace.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {};

    const allStrings = [name, email, password].every(
      (value) => typeof value === "string" && value.trim() !== ""
    );
    if (!allStrings) {
      return res
        .status(400)
        .json({ message: "Name, email and password are required" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Creates the user, their personal workspace and an owner membership together
    const user = await createUserWithPersonalWorkspace({
      name,
      email: normalizedEmail,
      password: hashedPassword,
    });

    return res.status(201).json({
      id: user._id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Email already registered" });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    console.error("Register error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    const allStrings = [email, password].every(
      (value) => typeof value === "string" && value.trim() !== ""
    );
    if (!allStrings) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (!process.env.JWT_SECRET) {
      console.error("Login error: JWT_SECRET is not set in .env");
      return res.status(500).json({ message: "Server error" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({}, process.env.JWT_SECRET, {
      subject: String(user._id),
      expiresIn: "1d",
    });

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/me", protect, (req, res) => {
  return res.status(200).json({ user: req.user });
});

export default router;