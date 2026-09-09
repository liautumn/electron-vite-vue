group "default" {
  targets = ["linux-amd64", "win-amd64"]
}

target "linux-amd64" {
  context    = "docker-build"
  dockerfile = "Dockerfile.linux"
  platforms  = ["linux/amd64"]
  tags       = ["electron-builder:node24-linux-amd64"]
}

target "win-amd64" {
  context    = "docker-build"
  dockerfile = "Dockerfile.win"
  platforms  = ["linux/amd64"]
  tags       = ["electron-builder:node24-win-amd64"]
}
