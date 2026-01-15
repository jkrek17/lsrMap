// ============================================================================
// TOAST SERVICE - Status notifications with retry support
// ============================================================================

let lastErrorAction = null;

export function showStatusToast(message, type = 'info', retryAction = null) {
    const toast = document.getElementById('statusToast');
    const toastMessage = document.getElementById('statusToastMessage');
    
    if (!toast || !toastMessage) return;
    
    // Clear any existing retry button
    const existingRetry = toast.querySelector('.toast-retry');
    if (existingRetry) existingRetry.remove();
    
    toastMessage.textContent = message;
    toast.className = `status-toast ${type}`;
    toast.style.display = 'flex';
    
    // Add retry button for errors with retry action
    if (type === 'error' && retryAction) {
        lastErrorAction = retryAction;
        const retryBtn = document.createElement('button');
        retryBtn.className = 'toast-retry';
        retryBtn.innerHTML = '<i class="fas fa-redo"></i> Retry';
        retryBtn.addEventListener('click', () => {
            toast.style.display = 'none';
            retryAction();
        });
        toastMessage.parentNode.insertBefore(retryBtn, toastMessage.nextSibling);
    }
    
    // Auto-hide after 5 seconds for success/info, 10 seconds for errors
    const timeout = (type === 'error' || type === 'loading') ? 10000 : 5000;
    setTimeout(() => {
        if (toast.style.display !== 'none') {
            toast.style.display = 'none';
        }
    }, timeout);
}
