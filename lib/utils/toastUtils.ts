/**
 * Toast notification utility for displaying temporary messages
 * Uses the browser's native capabilities with custom styling
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  duration?: number // milliseconds, 0 = no auto-dismiss
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
}

/**
 * Show a toast notification
 * Creates a simple HTML element and injects it into the DOM
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  options: ToastOptions = {}
): HTMLElement {
  const { duration = 3000, position = 'top-right' } = options

  // Create container if it doesn't exist
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `
    document.body.appendChild(container)
  }

  // Adjust position
  const [verticalPos, horizontalPos] = position.split('-')
  if (horizontalPos === 'left') {
    container.style.right = 'auto'
    container.style.left = '20px'
  } else if (horizontalPos === 'center') {
    container.style.right = 'auto'
    container.style.left = '50%'
    container.style.transform = 'translateX(-50%)'
  }
  if (verticalPos === 'bottom') {
    container.style.top = 'auto'
    container.style.bottom = '20px'
  }

  // Create toast element
  const toast = document.createElement('div')
  toast.style.cssText = `
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease-out;
    max-width: 400px;
    word-wrap: break-word;
    pointer-events: auto;
    cursor: pointer;
  `

  // Set colors based on type
  const colors: Record<ToastType, { bg: string; text: string; border: string }> = {
    success: {
      bg: '#ecfdf5',
      text: '#047857',
      border: '#6ee7b7',
    },
    error: {
      bg: '#fef2f2',
      text: '#dc2626',
      border: '#fca5a5',
    },
    info: {
      bg: '#eff6ff',
      text: '#0284c7',
      border: '#7dd3fc',
    },
    warning: {
      bg: '#fffbeb',
      text: '#d97706',
      border: '#fde68a',
    },
  }

  const color = colors[type]
  toast.style.backgroundColor = color.bg
  toast.style.color = color.text
  toast.style.borderLeft = `4px solid ${color.border}`

  toast.textContent = message

  // Add animation keyframes if not already added
  if (!document.getElementById('toast-animations')) {
    const style = document.createElement('style')
    style.id = 'toast-animations'
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(400px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @keyframes slideOut {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(400px);
        }
      }
    `
    document.head.appendChild(style)
  }

  container.appendChild(toast)

  // Remove on click
  toast.addEventListener('click', () => {
    toast.style.animation = 'slideOut 0.3s ease-out'
    setTimeout(() => {
      toast.remove()
    }, 300)
  })

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.animation = 'slideOut 0.3s ease-out'
        setTimeout(() => {
          toast.remove()
        }, 300)
      }
    }, duration)
  }

  return toast
}

export function successToast(message: string, duration?: number) {
  return showToast(message, 'success', { duration })
}

export function errorToast(message: string, duration?: number) {
  return showToast(message, 'error', { duration })
}

export function infoToast(message: string, duration?: number) {
  return showToast(message, 'info', { duration })
}

export function warningToast(message: string, duration?: number) {
  return showToast(message, 'warning', { duration })
}
