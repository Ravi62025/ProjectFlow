import jwt from "jsonwebtoken";
import User from "../models/User.js";

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized, token missing" });
  }

  const parts = authHeader.split(" ");
  const token = parts[1];

  if (parts.length !== 2 || !token) {
    return res.status(401).json({ message: "Not authorized, token missing" });
  }

  if (!process.env.JWT_SECRET) {
    console.error("Auth middleware error: JWT_SECRET is not set in .env");
    return res.status(500).json({ message: "Server error" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.sub).select("name email");
    if (!user) {
      return res.status(401).json({ message: "Not authorized, token invalid" });
    }

    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, token invalid" });
  }
};

export default protect;