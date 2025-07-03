import { createContext, useContext, useState, useEffect } from 'react';
import { BASE_URL } from '../config/AppConfig';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const API_BASE = BASE_URL;

  // Check if user is authenticated on app start
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setUser(result.user);
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = (userData) => {
    setUser(userData);
  };
  const logout = async () => {
    try {
      // First, clear local state immediately to prevent UI flickering
      setUser(null);
      
      const response = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        console.log('Logout successful');
      } else {
        console.warn('Logout request failed, but clearing local state anyway');
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
    
    // Don't call checkAuth immediately after logout to prevent race conditions
    // The session should be cleared on the server side
  };

  const updateUserCredits = async () => {
    if (!user) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/credits`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setUser(prev => ({
            ...prev,
            credits: result.credits
          }));
        }
      }
    } catch (error) {
      console.error('Failed to update credits:', error);
    }
  };

  const value = {
    user,
    loading,
    login,
    logout,
    updateUserCredits,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
