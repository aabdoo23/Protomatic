import { useState, useEffect, useCallback, useRef } from 'react';
import finetuningService from '../services/FinetuningService';
import { 
  JOB_STATUS, 
  DEFAULT_FINETUNE_PARAMS, 
  DEFAULT_GENERATION_PARAMS,
  POLLING_CONFIG
} from '../utils/FinetuningConstants';
import { 
  isJobActive, 
  generateJobSummary, 
  extractErrorInfo 
} from '../utils/FinetuningUtils';

/**
 * Comprehensive hook for fine-tuning functionality
 * Replaces the existing useFinetuning hook with full server integration
 */
export const useAdvancedFinetuning = () => {
  // Core state
  const [baseModels, setBaseModels] = useState([]);
  const [userJobs, setUserJobs] = useState([]);
  const [finetunedModels, setFinetunedModels] = useState([]);
  const [serverHealth, setServerHealth] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  
  // Error states
  const [error, setError] = useState(null);
  const [connectionError, setConnectionError] = useState(false);
  
  // Polling management
  const [pollingJobs, setPollingJobs] = useState(new Set());
  const pollingIntervals = useRef(new Map());
  
  // ========== ERROR HANDLING ==========
  
  const handleError = useCallback((error, context = '') => {
    const errorInfo = extractErrorInfo(error);
    console.error(`Error in ${context}:`, errorInfo);
    setError({ ...errorInfo, context });
    
    if (errorInfo.type === 'network') {
      setConnectionError(true);
    }
    
    return errorInfo;
  }, []);
  
  const clearError = useCallback(() => {
    setError(null);
    setConnectionError(false);
  }, []);
  
  // ========== SERVER COMMUNICATION ==========
  
  const checkServerHealth = useCallback(async () => {
    try {
      const health = await finetuningService.getHealth();
      setServerHealth(health);
      setConnectionError(false);
      return health;
    } catch (error) {
      const errorInfo = handleError(error, 'checkServerHealth');
      setServerHealth({ 
        status: 'unhealthy', 
        error: errorInfo.message,
        timestamp: new Date().toISOString() 
      });
      setConnectionError(true);
      return null;
    }
  }, [handleError]);
  
  const loadBaseModels = useCallback(async () => {
    try {
      const result = await finetuningService.getAvailableModels();
      const models = result.models || [];
      setBaseModels(models);
      return models;
    } catch (error) {
      handleError(error, 'loadBaseModels');
      return [];
    }
  }, [handleError]);
  
  const loadStatistics = useCallback(async () => {
    try {
      const stats = await finetuningService.getStatistics();
      setStatistics(stats);
      return stats;
    } catch (error) {
      handleError(error, 'loadStatistics');
      return null;
    }
  }, [handleError]);
  
  const loadStorageInfo = useCallback(async () => {
    try {
      const storage = await finetuningService.getStorageInfo();
      setStorageInfo(storage);
      return storage;
    } catch (error) {
      handleError(error, 'loadStorageInfo');
      return null;
    }
  }, [handleError]);
  
  const loadUserJobs = useCallback(async (limit = 100, status = null) => {
    try {
      const result = await finetuningService.listJobs({ limit, status });
      const jobs = (result.jobs || []).map(generateJobSummary);
      setUserJobs(jobs);
      
      // Update polling jobs based on active jobs
      const activeJobs = jobs
        .filter(job => isJobActive(job.status))
        .map(job => job.job_id);
      
      setPollingJobs(new Set(activeJobs));
      
      return jobs;
    } catch (error) {
      handleError(error, 'loadUserJobs');
      return [];
    }
  }, [handleError]);
  
  const loadFinetunedModels = useCallback(async (userName = null) => {
    try {
      const result = await finetuningService.getFinetunedModels(userName);
      const models = result.finetuned_models || [];
      setFinetunedModels(models);
      return models;
    } catch (error) {
      handleError(error, 'loadFinetunedModels');
      return [];
    }
  }, [handleError]);
  
  // ========== JOB MANAGEMENT ==========
  
  const startFinetuning = useCallback(async (params) => {
    setLoading(true);
    clearError();
    
    try {
      // Validate parameters
      const validation = finetuningService.validateFinetuningParams(params);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }
      
      // Merge with defaults
      const finalParams = { ...DEFAULT_FINETUNE_PARAMS, ...params };
      
      const result = await finetuningService.startFinetuning(finalParams);
      
      // Start polling for this job
      if (result.job_id) {
        setPollingJobs(prev => new Set([...prev, result.job_id]));
      }
      
      // Reload jobs
      await loadUserJobs();
      
      return result;
    } catch (error) {
      throw handleError(error, 'startFinetuning');
    } finally {
      setLoading(false);
    }
  }, [handleError, loadUserJobs, clearError]);
  
  const generateSequence = useCallback(async (params) => {
    setLoading(true);
    clearError();
    
    try {
      const { model_type, ...otherParams } = params;
      
      if (model_type === 'base') {
        // Generate using base model directly
        const validation = finetuningService.validateBaseModelGenerationParams({
          model_name: params.model_name,
          prompt: params.prompt,
          max_new_tokens: params.max_new_tokens,
          num_return_sequences: params.num_return_sequences,
          temperature: params.temperature,
          top_p: params.top_p,
          top_k: params.top_k,
        });
        
        if (!validation.isValid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }
        
        const result = await finetuningService.generateWithBaseModel({
          model_name: params.model_name,
          prompt: params.prompt,
          max_new_tokens: params.max_new_tokens || 200,
          num_return_sequences: params.num_return_sequences || 1,
          temperature: params.temperature || 1.0,
          top_p: params.top_p || 0.9,
          top_k: params.top_k || 50,
        });
        
        return result;
      } else {
        // Generate using finetuned model
        const validation = finetuningService.validateGenerationParams(params);
        if (!validation.isValid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }
        
        const finalParams = { ...DEFAULT_GENERATION_PARAMS, ...params };
        const result = await finetuningService.generateSequence(finalParams);
        
        return result;
      }
    } catch (error) {
      throw handleError(error, 'generateSequence');
    } finally {
      setLoading(false);
    }
  }, [handleError, clearError]);
  
  const getJobStatus = useCallback(async (jobId) => {
    try {
      const status = await finetuningService.getJobStatus(jobId);
      return generateJobSummary(status);
    } catch (error) {
      handleError(error, 'getJobStatus');
      return null;
    }
  }, [handleError]);
  
  const getJobProgress = useCallback(async (jobId) => {
    try {
      const progress = await finetuningService.getJobProgress(jobId);
      return progress;
    } catch (error) {
      handleError(error, 'getJobProgress');
      return null;
    }
  }, [handleError]);
  
  const getJobLogs = useCallback(async (jobId) => {
    try {
      const logs = await finetuningService.getJobTrainingLogs(jobId);
      return logs;
    } catch (error) {
      handleError(error, 'getJobLogs');
      return null;
    }
  }, [handleError]);
  
  const deleteJob = useCallback(async (jobId) => {
    try {
      const result = await finetuningService.deleteJob(jobId);
      
      // Stop polling this job
      setPollingJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
      
      // Reload jobs
      await loadUserJobs();
      
      return result;
    } catch (error) {
      throw handleError(error, 'deleteJob');
    }
  }, [handleError, loadUserJobs]);
  
  const cleanupJobFiles = useCallback(async (jobId) => {
    try {
      const result = await finetuningService.cleanupJobFiles(jobId);
      
      // Reload jobs and storage info
      await Promise.all([loadUserJobs(), loadStorageInfo()]);
      
      return result;
    } catch (error) {
      throw handleError(error, 'cleanupJobFiles');
    }
  }, [handleError, loadUserJobs, loadStorageInfo]);
  
  // ========== POLLING MANAGEMENT ==========
  
  const startPolling = useCallback((jobId) => {
    if (pollingIntervals.current.has(jobId)) {
      return; // Already polling
    }
    
    const interval = setInterval(async () => {
      try {
        const status = await getJobStatus(jobId);
        if (status && !isJobActive(status.status)) {
          // Job finished, stop polling
          clearInterval(interval);
          pollingIntervals.current.delete(jobId);
          setPollingJobs(prev => {
            const newSet = new Set(prev);
            newSet.delete(jobId);
            return newSet;
          });
          
          // Reload all jobs to get updated data
          await loadUserJobs();
        }
      } catch (error) {
        console.error(`Polling error for job ${jobId}:`, error);
      }
    }, POLLING_CONFIG.DEFAULT_INTERVAL);
    
    pollingIntervals.current.set(jobId, interval);
  }, [getJobStatus, loadUserJobs]);
  
  const stopPolling = useCallback((jobId) => {
    const interval = pollingIntervals.current.get(jobId);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.current.delete(jobId);
      setPollingJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
    }
  }, []);
  
  const stopAllPolling = useCallback(() => {
    pollingIntervals.current.forEach((interval, jobId) => {
      clearInterval(interval);
    });
    pollingIntervals.current.clear();
    setPollingJobs(new Set());
  }, []);
  
  // ========== UTILITY FUNCTIONS ==========
  
  const refreshAll = useCallback(async (userName = null) => {
    setLoading(true);
    try {
      await Promise.all([
        checkServerHealth(),
        loadBaseModels(),
        loadUserJobs(),
        loadFinetunedModels(userName),
        loadStatistics(),
        loadStorageInfo()
      ]);
    } finally {
      setLoading(false);
    }
  }, [checkServerHealth, loadBaseModels, loadUserJobs, loadFinetunedModels, loadStatistics, loadStorageInfo]);
  
  const isServerOnline = useCallback(() => {
    return serverHealth?.status === 'healthy' && !connectionError;
  }, [serverHealth, connectionError]);
  
  const getActiveJobs = useCallback(() => {
    return userJobs.filter(job => isJobActive(job.status));
  }, [userJobs]);
  
  const getCompletedJobs = useCallback(() => {
    return userJobs.filter(job => job.status === JOB_STATUS.COMPLETED);
  }, [userJobs]);
  
  const getFailedJobs = useCallback(() => {
    return userJobs.filter(job => job.status === JOB_STATUS.FAILED);
  }, [userJobs]);
  
  // ========== EFFECTS ==========
  
  // Initialize data on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        await refreshAll();
      } finally {
        setInitializing(false);
      }
    };
    
    initialize();
  }, [refreshAll]);
  
  // Manage polling for active jobs
  useEffect(() => {
    // Start polling for new jobs
    pollingJobs.forEach(jobId => {
      if (!pollingIntervals.current.has(jobId)) {
        startPolling(jobId);
      }
    });
    
    // Stop polling for removed jobs
    pollingIntervals.current.forEach((interval, jobId) => {
      if (!pollingJobs.has(jobId)) {
        stopPolling(jobId);
      }
    });
  }, [pollingJobs, startPolling, stopPolling]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllPolling();
    };
  }, [stopAllPolling]);
  
  // ========== RETURN OBJECT ==========
  
  return {
    // Data
    baseModels,
    userJobs,
    finetunedModels,
    serverHealth,
    statistics,
    storageInfo,
    
    // Computed data
    activeJobs: getActiveJobs(),
    completedJobs: getCompletedJobs(),
    failedJobs: getFailedJobs(),
    
    // State
    loading,
    initializing,
    error,
    connectionError,
    pollingJobs,
    
    // Actions
    startFinetuning,
    generateSequence,
    deleteJob,
    cleanupJobFiles,
    
    // Job queries
    getJobStatus,
    getJobProgress,
    getJobLogs,
    
    // Data loading
    loadUserJobs,
    loadBaseModels,
    loadFinetunedModels,
    loadStatistics,
    loadStorageInfo,
    refreshAll,
    
    // Server management
    checkServerHealth,
    isServerOnline: isServerOnline(),
    
    // Polling management
    startPolling,
    stopPolling,
    stopAllPolling,
    
    // Utilities
    clearError,
    hasActiveJobs: pollingJobs.size > 0,
    
    // Service access (for advanced usage)
    service: finetuningService
  };
};

export default useAdvancedFinetuning;
