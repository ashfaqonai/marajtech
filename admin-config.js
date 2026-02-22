// Admin Configuration
// The password is injected from GitHub Secrets during deployment.
// To set the password, add a repository secret named ADMIN_PASSWORD in GitHub Settings > Secrets.
// For local development, replace __ADMIN_PASSWORD_PLACEHOLDER__ with your password.

window.ADMIN_CONFIG = {
    password: '__ADMIN_PASSWORD_PLACEHOLDER__',

    github: {
        enabled: false,
        token: '',
        repo: 'your-username/your-repo',
        branch: 'main'
    }
};
