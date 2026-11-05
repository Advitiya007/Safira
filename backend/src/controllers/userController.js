import User from '../models/User.js';
import { decryptContact, encryptContact } from '../services/contactEncryptionService.js';

const serializeUser = (user) => {
    const data = user.toObject ? user.toObject() : { ...user };
    data.phone = decryptContact(data.phone);
    data.emergencyContactPhone = decryptContact(data.emergencyContactPhone);
    delete data.password;
    delete data.__v;
    delete data.contactEncryptionVersion;
    return data;
};

const getProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }
        res.status(200).json({ success: true, message: 'Profile fetched', data: serializeUser(user) });
    } catch (err) {
        next(err);
    }
};

const updateProfile = async (req, res, next) => {
    try {
        const { fullName, phone, emergencyContactName, emergencyContactPhone } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        if (phone && !/^\d{10}$/.test(phone)) {
            res.status(400);
            throw new Error('Phone number must be exactly 10 digits');
        }
        if (emergencyContactPhone && !/^\d{10}$/.test(emergencyContactPhone)) {
            res.status(400);
            throw new Error('Emergency contact phone number must be exactly 10 digits');
        }

        if (fullName) user.fullName = fullName;
        if (phone) user.phone = encryptContact(phone);
        if (emergencyContactName) user.emergencyContactName = emergencyContactName;
        if (emergencyContactPhone) user.emergencyContactPhone = encryptContact(emergencyContactPhone);
        user.contactEncryptionVersion = 1;

        await user.save();

        res.status(200).json({ success: true, message: 'Profile updated', data: serializeUser(user) });
    } catch (err) {
        next(err);
    }
};

const changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            res.status(400);
            throw new Error('Please provide current and new password');
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            res.status(400);
            throw new Error('Incorrect current password');
        }

        user.password = newPassword;
        await user.save();

        res.status(200).json({ success: true, message: 'Password changed successfully', data: {} });
    } catch (err) {
        next(err);
    }
};

const deleteAccount = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }
        user.isActive = false;
        await user.save();

        res.status(200).json({ success: true, message: 'Account deactivated', data: {} });
    } catch (err) {
        next(err);
    }
};

export { getProfile, updateProfile, changePassword, deleteAccount };
