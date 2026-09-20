import axios from 'axios'

// Dedicated Axios Client for LocalDrop API
const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
})

// Global response interceptor for clean error handling
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const errorMsg =
      error.response?.data?.message || error.message || 'API request failed'
    console.error('[API Error]:', errorMsg)
    return Promise.reject(new Error(errorMsg))
  }
)

/* -------------------------------------------------------------
 * DEVICE API SERVICE
 * ------------------------------------------------------------- */
export const deviceApi = {
  // Get all devices (optionally filter by online status)
  getDevices: (onlineOnly = false) => {
    return apiClient.get('/devices', {
      params: onlineOnly ? { online: true } : {},
    })
  },

  // Get specific device details
  getDeviceById: (deviceId) => {
    return apiClient.get(`/devices/${deviceId}`)
  },

  // Register device identity upon startup
  registerDevice: (deviceData) => {
    return apiClient.post('/devices/register', deviceData)
  },

  // Update device name, type, or trusted status
  updateDevice: (deviceId, updateData) => {
    return apiClient.patch(`/devices/${deviceId}`, updateData)
  },

  // Get list of trusted devices from MongoDB
  getTrustedDevices: (deviceId) => {
    return apiClient.get(`/devices/${deviceId}/trusted`)
  },

  // Add trusted device
  addTrustedDevice: (deviceId, targetDeviceId) => {
    return apiClient.post(`/devices/${deviceId}/trust`, { targetDeviceId })
  },

  // Remove trusted device
  removeTrustedDevice: (deviceId, targetDeviceId) => {
    return apiClient.delete(`/devices/${deviceId}/trust/${targetDeviceId}`)
  },
}

/* -------------------------------------------------------------
 * TRANSFER API SERVICE
 * ------------------------------------------------------------- */
export const transferApi = {
  // Get transfer history with optional deviceId or status filters
  getTransfers: (params = {}) => {
    return apiClient.get('/transfers', { params })
  },

  // Get specific transfer record
  getTransferById: (transferId) => {
    return apiClient.get(`/transfers/${transferId}`)
  },

  // Clear transfer history
  clearTransfers: (deviceId = null) => {
    return apiClient.delete('/transfers', {
      params: deviceId ? { deviceId } : {},
    })
  },
}

/* -------------------------------------------------------------
 * HEALTH & DIAGNOSTICS API
 * ------------------------------------------------------------- */
export const healthApi = {
  checkBackend: () => {
    return axios.get('/')
  },
}

export const networkApi = {
  getNetworkInfo: () => {
    return apiClient.get('/network-info')
  },
}

export default apiClient
