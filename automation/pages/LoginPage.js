export class LoginPage {
  constructor(page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Welcome to TestLab Store', exact: true })
    this.email = page.getByRole('textbox', { name: 'Email', exact: true })
    this.password = page.getByLabel('Password', { exact: true })
    this.submitButton = page.getByRole('button', { name: 'Log in', exact: true })
  }

  async open() {
    await this.page.goto('/')
  }

  async login({ email, password }) {
    await this.email.fill(email)
    await this.password.fill(password)
    await this.submitButton.click()
  }
}
