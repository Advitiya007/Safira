import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Guardian from '../models/Guardian.js';
import { logActivity } from './activityController.js';
import { decryptContact, encryptContact, hashContact } from '../services/contactEncryptionService.js';

const serializeUser = (user) => {
    const data = user.toObject ? user.toObject() : { ...user };
    data.phone = decryptContact(data.phone);
    data.emergencyContactPhone = decryptContact(data.emergencyContactPhone);
    delete data.password;
    delete data.__v;
    delete data.contactEncryptionVersion;
    return data;
};

const serializeGuardian = (guardian) => ({
    guardianId: guardian._id,
    guardianName: guardian.guardianName,
    guardianPhone: decryptContact(guardian.guardianPhone),
    relationship: guardian.relationship,
});

const generateToken = (userId, email) => {
    return jwt.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const registerUser = async (req, res, next) => {
    try {
        const { 
            fullName, 
            email, 
            phone, 
            password, 
            confirmPassword, 
            termsAccepted,
            emergencyContactName, 
            emergencyContactPhone, 
            emergencyContactRelationship 
        } = req.body;

        // Step 1: Validation
        if (!fullName || !email || !phone || !password || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be provided'
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        // Phone validation
        const phoneRegex = /^\d{10}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Phone number must be exactly 10 digits'
            });
        }
        if (emergencyContactPhone && !phoneRegex.test(emergencyContactPhone)) {
            return res.status(400).json({
                success: false,
                message: 'Emergency contact phone number must be exactly 10 digits'
            });
        }

        // Password validation
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters long'
            });
        }

        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~])/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one uppercase, one lowercase, one number, and one special character'
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match'
            });
        }

        // Terms of Service validation
        if (!termsAccepted) {
            return res.status(400).json({
                success: false,
                message: 'You must accept the Terms of Service and Privacy Policy'
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match'
            });
        }

        // Check if email already exists
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Step 2: Create User
        const user = await User.create({
            fullName,
            email,
            phone: encryptContact(phone),
            password,
            emergencyContactName,
            emergencyContactPhone: encryptContact(emergencyContactPhone),
            contactEncryptionVersion: 1,
            termsAcceptedAt: new Date(),
            isActive: true,
            lastLogin: new Date()
        });

        let guardian = null;

        // Step 3: Create Guardian (if emergency contact provided)
        if (emergencyContactName && emergencyContactPhone) {
            // Validate emergency contact phone
            if (!phoneRegex.test(emergencyContactPhone)) {
                return res.status(400).json({
                    success: false,
                    message: 'Emergency contact phone number must be exactly 10 digits'
                });
            }

            // Check if guardian already exists for this user
            const guardianPhoneHash = hashContact(emergencyContactPhone);
            const existingGuardian = await Guardian.findOne({
                userId: user._id,
                guardianPhoneHash,
            }).select('+guardianPhoneHash');
            
            if (existingGuardian) {
                return res.status(400).json({
                    success: false,
                    message: 'This emergency contact is already added'
                });
            }

            guardian = await Guardian.create({
                userId: user._id,
                guardianName: emergencyContactName,
                guardianPhone: encryptContact(emergencyContactPhone),
                guardianPhoneHash,
                contactEncryptionVersion: 1,
                relationship: emergencyContactRelationship || 'Other',
                status: 'active',
                addedAt: Date.now(),
                isVerified: false
            });
        }

        // Step 4: Generate JWT Token
        const token = generateToken(user._id, user.email);

        await logActivity(user._id, 'login', { method: 'register' });

        // Step 5: Return Response
        const responseData = {
            token,
            user: {
                userId: user._id,
                fullName: user.fullName,
                email: user.email,
                phone: decryptContact(user.phone)
            }
        };

        if (guardian) {
            responseData.guardian = serializeGuardian(guardian);
        }
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: responseData
        });
    } catch (err) {
        next(err);
    }
};

const loginUser = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            res.status(400);
            throw new Error('Please provide email and password');
        }

        const user = await User.findOne({ email });
        if (!user || !user.isActive) {
            res.status(401);
            throw new Error('Invalid credentials');
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            res.status(401);
            throw new Error('Invalid credentials');
        }

        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user._id, user.email);

        await logActivity(user._id, 'login', { ip: req.ip });

        res.status(200).json({
            success: true,
            message: 'Logged in successfully',
            data: { token, user: serializeUser(user) }
        });
    } catch (err) {
        next(err);
    }
};

const logoutUser = async (req, res, next) => {
    try {
        await logActivity(req.user.userId, 'logout', {});
        res.status(200).json({ success: true, message: 'Logged out successfully', data: {} });
    } catch (err) {
        next(err);
    }
};

const getCurrentUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }
        res.status(200).json({ success: true, message: 'User fetched', data: serializeUser(user) });
    } catch (err) {
        next(err);
    }
};

const refreshToken = async (req, res, next) => {
    try {
        const token = generateToken(req.user.userId, req.user.email);
        res.status(200).json({ success: true, message: 'Token refreshed', data: { token } });
    } catch (err) {
        next(err);
    }
};

export { registerUser, loginUser, logoutUser, getCurrentUser, refreshToken };
