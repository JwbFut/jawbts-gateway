import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import './styles/main.css'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(router)

app.mount('#app')

// Restore the saved session in the background. The router guard awaits the
// same promise when a protected route is opened directly.
const auth = useAuthStore(pinia)
void auth.initialize().catch(() => undefined)
