<template>
  <div class="app">
    <header class="header">
      <div class="brand">Vue Router Demo</div>
      <nav class="nav">
        <router-link to="/">首页</router-link>
        <router-link to="/pinia-demo">Pinia Demo</router-link>
        <router-link to="/serialport-demo">Serialport Demo</router-link>
      </nav>
    </header>
    <main class="content">
      <router-view/>
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #f7f8fa;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #001529;
  color: #fff;
}

.brand {
  font-weight: 600;
}

.nav {
  display: flex;
  gap: 16px;
}

.nav a {
  color: #fff;
  text-decoration: none;
}

.nav a.router-link-active {
  text-decoration: underline;
}

.content {
  padding: 16px;
}
</style>
