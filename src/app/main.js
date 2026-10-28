import '../assets/base.css'
import '../assets/tailwind.css'

import { createApp } from 'vue'
import App from './App.vue'
import { createAppRouter } from './router.js'
import { loadPolicy } from '../utils/policy.js'

loadPolicy()
createApp(App).use(createAppRouter()).mount('#app')
