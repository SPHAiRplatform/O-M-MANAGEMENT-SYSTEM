import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage, errorContains } from '../utils/errorHandler';
import { forgotPassword, resetPassword } from '../api/api';
import logo from '../assets/logo.png';
import './Login.css';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Forgot-password state: null = login view, 'email' | 'code' | 'newpass'
  const [resetStep, setResetStep] = useState(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Auto-dismiss success messages after 4 seconds
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  const containerRef = useRef(null);
  const boxRef = useRef(null);
  const glowRef = useRef(null);
  const rafRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });

  const handleMouseMove = useCallback((e) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    mouseRef.current = {
      x: (clientX / innerWidth - 0.5) * 2,
      y: (clientY / innerHeight - 0.5) * 2
    };
    if (glowRef.current) {
      glowRef.current.style.left = `${clientX}px`;
      glowRef.current.style.top = `${clientY}px`;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const { x, y } = mouseRef.current;
      if (boxRef.current) {
        boxRef.current.style.transform =
          `perspective(1000px) rotateX(${-y * 2}deg) rotateY(${x * 2}deg)`;
      }
      if (containerRef.current) {
        containerRef.current.querySelectorAll('.login-shape').forEach((shape) => {
          const speed = parseFloat(shape.dataset.speed || 1);
          shape.style.transform = `translate(${x * 30 * speed}px, ${y * 20 * speed}px)`;
        });
      }
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (boxRef.current) {
      boxRef.current.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';
    }
    if (containerRef.current) {
      containerRef.current.querySelectorAll('.login-shape').forEach((shape) => {
        shape.style.transform = 'translate(0px, 0px)';
      });
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated()) navigate('/');
    const rememberedUsername = localStorage.getItem('remembered_username');
    const rememberedPassword = localStorage.getItem('remembered_password');
    if (rememberedUsername) {
      setUsername(rememberedUsername);
      if (rememberedPassword) setPassword(rememberedPassword);
      setRememberMe(true);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const normalizedUsername = (username || '').trim();
    if (!normalizedUsername || !password) {
      setError('Username and password required');
      setLoading(false);
      return;
    }
    try {
      const result = await login(normalizedUsername, password, rememberMe);
      if (result.success) {
        if (rememberMe) {
          localStorage.setItem('remembered_username', normalizedUsername);
          localStorage.setItem('remembered_password', password);
        } else {
          localStorage.removeItem('remembered_username');
          localStorage.removeItem('remembered_password');
        }
        if (typeof PasswordCredential !== 'undefined') {
          try {
            await navigator.credentials.store(new PasswordCredential({ id: normalizedUsername, password, name: normalizedUsername }));
          } catch (_) {}
        }
        navigate('/');
      } else {
        const errorMsg = getErrorMessage(result.error || result, 'Incorrect password');
        if (errorContains(result.error || result, 'ACCESS RESTRICTED') && result.admin_email) {
          setError(`Access restricted\nContact administrator: ${result.admin_email}`);
        } else {
          setError(errorMsg);
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Connection failed'));
    } finally {
      setLoading(false);
    }
  };

  // --- Forgot-password handlers ---

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!resetEmail.trim()) { setError('Please enter your email or username'); return; }
    setLoading(true);
    try {
      await forgotPassword(resetEmail.trim());
      setSuccessMsg('A 6-digit code has been sent to your email.');
      setResetStep('code');
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!resetCode.trim() || resetCode.trim().length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    setSuccessMsg('');
    setResetStep('newpass');
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const res = await resetPassword(resetEmail.trim(), resetCode.trim(), newPassword);
      setSuccessMsg(res.data?.message || 'Password reset successfully. You can now sign in.');
      setTimeout(() => {
        setResetStep(null);
        setResetEmail('');
        setResetCode('');
        setNewPassword('');
        setConfirmPassword('');
        setSuccessMsg('');
        setError('');
      }, 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed. Check your code and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setResetStep(null);
    setResetEmail('');
    setResetCode('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccessMsg('');
  };

  // --- Password strength (reused from PasswordChangeModal) ---
  const getStrength = (pw) => {
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z\d]/.test(pw)) score++;
    return score;
  };
  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const strengthColors = ['', '#e53935', '#ff9800', '#fbc02d', '#4caf50', '#2e7d32'];

  // --- Render helpers ---

  const renderResetEmailForm = () => (
    <form onSubmit={handleRequestCode} className="login-form">
      <div className="form-group">
        <label htmlFor="resetEmail">Email or Username</label>
        <input
          type="text"
          id="resetEmail"
          value={resetEmail}
          onChange={(e) => setResetEmail(e.target.value)}
          placeholder="Enter your email or username"
          autoComplete="email"
          disabled={loading}
          required
          autoFocus
        />
        <small style={{ color: '#888', display: 'block', marginTop: '6px' }}>
          Enter the email or username registered to your account.
        </small>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={loading || !resetEmail.trim()}>
        {loading ? <><span className="spinner"></span>Sending...</> : 'Send Reset Code'}
      </button>
      <div style={{ textAlign: 'center', marginTop: '16px' }}>
        <button type="button" className="forgot-password-link" onClick={handleBackToLogin}>
          Back to Sign In
        </button>
      </div>
    </form>
  );

  const renderCodeForm = () => (
    <form onSubmit={handleVerifyCode} className="login-form">
      <div className="form-group">
        <label htmlFor="resetCode">Enter the 6-digit code</label>
        <input
          type="text"
          id="resetCode"
          value={resetCode}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setResetCode(v);
          }}
          placeholder="123456"
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={loading}
          required
          autoFocus
          style={{ textAlign: 'center', letterSpacing: '8px', fontSize: '24px', fontWeight: 'bold' }}
        />
        <small style={{ color: '#999', display: 'block', marginTop: '6px' }}>Check your email for the code. It expires in 15 minutes.</small>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={loading || resetCode.length !== 6}>
        Verify Code
      </button>
      <div style={{ textAlign: 'center', marginTop: '12px' }}>
        <button type="button" className="forgot-password-link" onClick={() => { setResetStep('email'); setResetCode(''); setError(''); setSuccessMsg(''); }}>
          Didn't get the code? Resend
        </button>
      </div>
      <div style={{ textAlign: 'center', marginTop: '4px' }}>
        <button type="button" className="forgot-password-link" onClick={handleBackToLogin}>
          Back to Sign In
        </button>
      </div>
    </form>
  );

  const strength = getStrength(newPassword);

  const renderNewPasswordForm = () => (
    <form onSubmit={handleResetPassword} className="login-form">
      <div className="form-group">
        <label htmlFor="newPassword">New Password</label>
        <div className="password-input-wrapper">
          <input
            type={showNewPassword ? 'text' : 'password'}
            id="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
            autoComplete="new-password"
            disabled={loading}
            required
            autoFocus
          />
          <button type="button" className="password-toggle" onClick={() => setShowNewPassword(!showNewPassword)} tabIndex={-1}>
            <i className={`bi ${showNewPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
          </button>
        </div>
        {newPassword && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: i <= strength ? strengthColors[strength] : '#e0e0e0', transition: 'background .3s' }} />
              ))}
            </div>
            <small style={{ color: strengthColors[strength], fontWeight: 500 }}>{strengthLabels[strength]}</small>
          </div>
        )}
      </div>
      <div className="form-group">
        <label htmlFor="confirmPassword">Confirm Password</label>
        <input
          type="password"
          id="confirmPassword"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter new password"
          autoComplete="new-password"
          disabled={loading}
          required
        />
        {confirmPassword && newPassword !== confirmPassword && (
          <small style={{ color: '#e53935', marginTop: '4px', display: 'block' }}>Passwords do not match</small>
        )}
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}>
        {loading ? <><span className="spinner"></span>Resetting...</> : 'Reset Password'}
      </button>
      <div style={{ textAlign: 'center', marginTop: '16px' }}>
        <button type="button" className="forgot-password-link" onClick={handleBackToLogin}>
          Back to Sign In
        </button>
      </div>
    </form>
  );

  const resetTitles = {
    email: 'Reset Your Password',
    code: 'Enter Verification Code',
    newpass: 'Set New Password'
  };

  return (
    <div
      className="login-container"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="login-glow" ref={glowRef} />
      <div className="login-shape shape-1" data-speed="0.5" />
      <div className="login-shape shape-2" data-speed="0.8" />
      <div className="login-shape shape-3" data-speed="1.2" />
      <div className="login-shape shape-4" data-speed="0.3" />
      <div className="login-shape shape-5" data-speed="1.0" />
      <div className="login-shape shape-6" data-speed="0.6" />

      <div className="login-box" ref={boxRef}>
        <div className="login-header">
          <div className="login-logo">
            <img src={logo} alt="SPHAiRDigital Logo" />
          </div>
          <h1>SPHAiRDigital</h1>
          <p>{resetStep ? resetTitles[resetStep] : 'Sign in to your account'}</p>
        </div>

        {successMsg && (
          <div className="alert" style={{ background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' }}>
            {successMsg}
          </div>
        )}

        {error && (
          <div className={`alert ${errorContains(error, 'ACCESS RESTRICTED') ? 'alert-restricted' : 'alert-error'}`}>
            {getErrorMessage(error).split('\n').map((line, idx, lines) => (
              <React.Fragment key={idx}>
                {line}
                {idx < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* FORGOT PASSWORD FLOW */}
        {resetStep === 'email' && renderResetEmailForm()}
        {resetStep === 'code' && renderCodeForm()}
        {resetStep === 'newpass' && renderNewPasswordForm()}

        {/* NORMAL LOGIN */}
        {!resetStep && (
          <>
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="username">Username or Email</label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username or email"
                  autoComplete="username"
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={loading}
                    required
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                  </button>
                </div>
              </div>
              <div className="login-options">
                <label className="remember-me">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} disabled={loading} />
                  <span>Remember me</span>
                </label>
                <button type="button" className="forgot-password-link" onClick={() => { setResetStep('email'); setError(''); }} disabled={loading}>
                  Forgot password?
                </button>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                {loading ? <><span className="spinner"></span>Signing in...</> : 'Sign In'}
              </button>
            </form>
            <div className="login-footer">
              <p className="text-muted">Need help? Contact your system administrator</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

Login.propTypes = {};

export default Login;
