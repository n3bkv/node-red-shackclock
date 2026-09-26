module.exports = {
    flowFile: 'flows.json',
    uiPort: Number(process.env.PORT || 4040),
    httpAdminRoot: '/admin',
    httpNodeRoot: '/api',

    // Static ShackClock UI is part of the immutable container image.
    // It is deliberately outside /data so the persistent Docker volume
    // cannot hide it or cause nested bind-mount permission problems.
    httpStatic: '/opt/shackclock/public',
    httpStaticOptions: {
        maxAge: 0,
        etag: false,
        lastModified: false,
        setHeaders: function(res) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    },

    disableEditor: false,
    functionGlobalContext: { fs: require('fs') },
    logging: {
        console: { level: 'info', metrics: false, audit: false }
    },
    editorTheme: {
        projects: { enabled: false }
    }
};
