import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getProfile, updateProfile, uploadProfileImage, removeProfileImage } from '../api/api';
import { getApiBaseUrl } from '../api/api';
import { ConfirmDialog } from './ConfirmDialog';
import './Profile.css';

function Profile() {
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);
  
  // Initialize profile data from current user context (for immediate display)
  const nameParts = (user?.full_name || '').split(' ').filter(p => p.trim());
  const firstName = nameParts.slice(0, -1).join(' ') || '';
  const surname = nameParts[nameParts.length - 1] || '';
  
  const [profileData, setProfileData] = useState({
    full_name: user?.full_name || '',
    firstName: firstName,
    surname: surname,
    email: user?.email || '',
    username: user?.username || ''
  });
  
  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  
  // Get roles from user context
  const getUserRoles = () => {
    if (!user) return [];
    if (user.roles && Array.isArray(user.roles)) {
      return user.roles;
    }
    if (user.role) {
      return [user.role];
    }
    return [];
  };
  
  const [roles, setRoles] = useState(getUserRoles());
  
  // Get default profile image path
  const getDefaultProfileImage = () => {
    const baseUrl = getApiBaseUrl().replace('/api', '');
    return `${baseUrl}/uploads/profiles/No_Profile.png`;
  };

  // Check if image is the default profile image
  const isDefaultImage = (imagePath) => {
    if (!imagePath) return true;
    return imagePath.includes('No_Profile.png') || imagePath.includes('No_Profile');
  };

  // Set profile image from user context
  const [profileImage, setProfileImage] = useState(user?.profile_image || null);
  const [imagePreview, setImagePreview] = useState(() => {
    if (user?.profile_image && !isDefaultImage(user.profile_image)) {
      const baseUrl = getApiBaseUrl().replace('/api', '');
      return `${baseUrl}${user.profile_image}`;
    }
    // Show default image if no profile image or if it's the default
    return getDefaultProfileImage();
  });
  
  const [uploadingImage, setUploadingImage] = useState(false);

  // Load fresh profile data from API (silently in background)
  useEffect(() => {
    const loadFreshProfile = async () => {
      if (!user) return;
      
      try {
        const response = await getProfile();
        const data = response.data;
        
        // Parse full_name into first name and surname
        const nameParts = (data.full_name || '').split(' ').filter(p => p.trim());
        const firstName = nameParts.slice(0, -1).join(' ') || '';
        const surname = nameParts[nameParts.length - 1] || '';
        
        // Update profile data with fresh data from server
        setProfileData({
          full_name: data.full_name || '',
          firstName: firstName,
          surname: surname,
          email: data.email || '',
          username: data.username || ''
        });
        
        // Update roles
        let userRoles = [];
        if (data.roles) {
          if (Array.isArray(data.roles)) {
            userRoles = data.roles;
          } else if (typeof data.roles === 'string') {
            try {
              userRoles = JSON.parse(data.roles);
            } catch (e) {
              userRoles = [data.role || 'technician'];
            }
          }
        } else {
          userRoles = [data.role || 'technician'];
        }
        setRoles(userRoles);
        
        // Update profile image
        if (data.profile_image && !isDefaultImage(data.profile_image)) {
          const baseUrl = getApiBaseUrl().replace('/api', '');
          setProfileImage(data.profile_image);
          setImagePreview(`${baseUrl}${data.profile_image}`);
        } else {
          // Use default image if no profile image or if it's the default
          setProfileImage(null);
          setImagePreview(getDefaultProfileImage());
        }
        
        // Update user context with fresh data
        if (setUser) {
          setUser({
            ...user,
            full_name: data.full_name,
            email: data.email,
            profile_image: data.profile_image,
            roles: userRoles,
            role: userRoles[0] || user.role
          });
        }
      } catch (error) {
        // Silently fail - user still sees their context data
        console.error('Error loading fresh profile data:', error);
        // Don't show error to user since they already have data from context
      }
    };
    
    loadFreshProfile();
  }, [user?.id]); // Only reload when user ID changes (not on every user object change)

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!profileData.firstName.trim() || !profileData.surname.trim()) {
      setError('First name and surname are required');
      return;
    }
    
    if (!profileData.email.trim()) {
      setError('Email is required');
      return;
    }
    
    try {
      setSaving(true);
      const fullName = `${profileData.firstName.trim()} ${profileData.surname.trim()}`.trim();
      
      const response = await updateProfile({
        full_name: fullName,
        email: profileData.email,
        username: profileData.username
      });
      
      setSuccess('Profile updated successfully!');
      setProfileData({ ...profileData, full_name: fullName });
      
      // Update user context
      if (setUser && response.data.user) {
        setUser({
          ...user,
          full_name: fullName,
          email: response.data.user.email
        });
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error updating profile:', error);
      const { getErrorMessage } = require('../utils/errorHandler');
      setError(getErrorMessage(error, 'Failed to update profile'));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!passwordData.current_password) {
      setError('Current password is required');
      return;
    }
    
    if (!passwordData.new_password || passwordData.new_password.length < 6) {
      setError('New password must be at least 6 characters long');
      return;
    }
    
    if (passwordData.new_password !== passwordData.confirm_password) {
      setError('New passwords do not match');
      return;
    }
    
    try {
      setSaving(true);
      await updateProfile({
        password: passwordData.new_password,
        current_password: passwordData.current_password
      });
      
      setSuccess('Password changed successfully!');
      setPasswordData({
        current_password: '',
        new_password: '',
        confirm_password: ''
      });
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error changing password:', error);
      const { getErrorMessage } = require('../utils/errorHandler');
      setError(getErrorMessage(error, 'Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file format. Supported formats: JPEG, PNG, GIF, WebP. Max size: 5MB.');
      return;
    }
    
    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size too large. Max size: 5MB. Supported formats: JPEG, PNG, GIF, WebP.');
      return;
    }
    
    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
    
    // Upload image
    uploadImage(file);
  };

  const uploadImage = async (file) => {
    try {
      setUploadingImage(true);
      setError('');
      console.log('[PROFILE] Uploading image:', file.name, file.size, file.type);
      
      const response = await uploadProfileImage(file);
      console.log('[PROFILE] Upload response:', response.data);
      
      if (!response.data || !response.data.profile_image) {
        throw new Error('Invalid response from server');
      }
      
      // Update profile image
      const baseUrl = getApiBaseUrl().replace('/api', '');
      const profileImagePath = response.data.profile_image;
      setProfileImage(profileImagePath);
      setImagePreview(`${baseUrl}${profileImagePath}`);
      
      // Update user context
      if (setUser) {
        setUser({
          ...user,
          profile_image: profileImagePath
        });
      }
      
      setSuccess('Profile image uploaded successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('[PROFILE] Error uploading image:', error);
      console.error('[PROFILE] Error response:', error.response?.data);
      console.error('[PROFILE] Error status:', error.response?.status);
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.details || 
                          error.message || 
                          'Failed to upload image. Please try again.';
      setError(errorMessage);
      setImagePreview(getDefaultProfileImage());
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveImage = async () => {
    setConfirmDialog({
      title: 'Remove Profile Image',
      message: 'Are you sure you want to remove your profile image?',
      confirmLabel: 'Remove',
      variant: 'warning',
      onConfirm: async () => {
        try {
          setUploadingImage(true);
          setError('');

          const response = await removeProfileImage();
          console.log('[PROFILE] Remove response:', response.data);

          // Clear profile image and show default
          setProfileImage(null);
          setImagePreview(getDefaultProfileImage());

          // Update user context
          if (setUser) {
            setUser({
              ...user,
              profile_image: null
            });
          }

          setSuccess('Profile image removed successfully!');
          setTimeout(() => setSuccess(''), 3000);
        } catch (error) {
          console.error('[PROFILE] Error removing image:', error);
          const errorMessage = error.response?.data?.error ||
                              error.response?.data?.details ||
                              error.message ||
                              'Failed to remove image. Please try again.';
          setError(errorMessage);
        } finally {
          setUploadingImage(false);
        }
      }
    });
  };

  const getRoleBadgeClass = (role) => {
    switch (role) {
      // Legacy roles
      case 'super_admin':
        return 'badge-super-admin';
      case 'admin':
        return 'badge-admin';
      case 'technician':
        return 'badge-technician';
      // RBAC roles
      case 'system_owner':
        return 'badge-super-admin'; // Use same styling as super_admin
      case 'operations_admin':
        return 'badge-admin'; // Use same styling as admin
      case 'supervisor':
        return 'badge-supervisor';
      case 'general_worker':
        return 'badge-worker';
      case 'inventory_controller':
        return 'badge-inventory';
      default:
        return 'badge-default';
    }
  };

  const getRoleDisplayName = (role) => {
    switch (role) {
      // Legacy roles (for backward compatibility)
      case 'super_admin':
        return 'Super Admin';
      case 'admin':
        return 'Admin';
      case 'technician':
        return 'Technician';
      // RBAC roles
      case 'system_owner':
        return 'System Owner';
      case 'operations_admin':
        return 'Operations Administrator';
      case 'supervisor':
        return 'Supervisor';
      case 'general_worker':
        return 'General Worker';
      case 'inventory_controller':
        return 'Inventory Controller';
      default:
        // Fallback: format role code (e.g., "some_role" -> "Some Role")
        return role.split('_').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
  };

  if (!user) {
    return (
      <div className="profile-container">
        <div className="loading">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <h1>My Profile</h1>
      
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '20px' }}>
          {error}
        </div>
      )}
      
      {success && (
        <div className="alert alert-success" style={{ marginBottom: '20px' }}>
          {success}
        </div>
      )}

      <div className="profile-content">
        {/* Profile Image Section */}
        <div className="profile-section">
          <h2>Profile Picture</h2>
          <div className="profile-image-section">
            <div className="profile-image-container">
              <img 
                src={imagePreview || getDefaultProfileImage()} 
                alt="Profile" 
                className="profile-image"
                onError={(e) => {
                  e.target.src = getDefaultProfileImage();
                }}
              />
            </div>
            <div className="profile-image-actions">
              {profileImage && !isDefaultImage(profileImage) ? (
                <div className="profile-image-buttons">
                  <label className="btn btn-primary profile-upload-btn" style={{ cursor: uploadingImage ? 'not-allowed' : 'pointer', opacity: uploadingImage ? 0.6 : 1 }}>
                    {uploadingImage ? 'Uploading...' : 'Upload'}
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                      onChange={handleImageSelect}
                      style={{ display: 'none' }}
                      disabled={uploadingImage}
                    />
                  </label>
                  <button 
                    type="button" 
                    className="btn btn-secondary profile-remove-btn" 
                    onClick={handleRemoveImage}
                    disabled={uploadingImage}
                    style={{ cursor: uploadingImage ? 'not-allowed' : 'pointer', opacity: uploadingImage ? 0.6 : 1 }}
                  >
                    {uploadingImage ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              ) : (
                <label className="btn btn-primary profile-upload-btn" style={{ cursor: uploadingImage ? 'not-allowed' : 'pointer', opacity: uploadingImage ? 0.6 : 1 }}>
                  {uploadingImage ? 'Uploading...' : 'Upload'}
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    onChange={handleImageSelect}
                    style={{ display: 'none' }}
                    disabled={uploadingImage}
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Personal Information Section */}
        <div className="profile-section">
          <h2>Personal Information</h2>
          <form onSubmit={handleProfileUpdate}>
            <div className="form-row">
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={profileData.username}
                  onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                  className="form-control"
                  placeholder="Enter username"
                />
              </div>
              
              <div className="form-group">
                <label>First Name *</label>
                <input
                  type="text"
                  value={profileData.firstName || ''}
                  onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })}
                  className="form-control"
                  required
                />
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Surname *</label>
                <input
                  type="text"
                  value={profileData.surname || ''}
                  onChange={(e) => setProfileData({ ...profileData, surname: e.target.value })}
                  className="form-control"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={profileData.email}
                  onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                  className="form-control"
                  required
                />
              </div>
            </div>
            
            <button type="submit" className="btn btn-primary profile-submit-btn" disabled={saving}>
              {saving ? 'Saving...' : 'Update'}
            </button>
          </form>
        </div>

        {/* Roles Section */}
        <div className="profile-section">
          <h2>Assigned Roles</h2>
          <div className="roles-display">
            {roles.length > 0 ? (
              <div className="role-badges">
                {roles.map((role, idx) => (
                  <span key={idx} className={`badge ${getRoleBadgeClass(role)}`}>
                    {getRoleDisplayName(role)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted">No roles assigned</p>
            )}
          </div>
        </div>

        {/* Change Password Section */}
        <div className="profile-section">
          <h2>Change Password</h2>
          <form onSubmit={handlePasswordChange}>
            <div className="form-row form-row-password">
              <div className="form-group">
                <label>Current Password *</label>
                <input
                  type="password"
                  value={passwordData.current_password}
                  onChange={(e) => setPasswordData({ ...passwordData, current_password: e.target.value })}
                  className="form-control"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>New Password *</label>
                <input
                  type="password"
                  value={passwordData.new_password}
                  onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                  className="form-control"
                  required
                  minLength={6}
                />
                <small className="form-text text-muted">Must be at least 6 characters long</small>
              </div>
            </div>
            
            <div className="form-group form-group-full form-group-password">
              <label>Confirm New Password *</label>
              <input
                type="password"
                value={passwordData.confirm_password}
                onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                className="form-control"
                required
                minLength={6}
              />
            </div>
            
            <button type="submit" className="btn btn-primary profile-password-btn" disabled={saving}>
              {saving ? 'Changing...' : 'Change'}
            </button>
          </form>
        </div>
      </div>

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}

export default Profile;
