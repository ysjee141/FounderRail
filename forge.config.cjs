module.exports = {
  packagerConfig: {
    name: "Founder Desk",
    executableName: "founder-desk",
    appBundleId: "com.founderdesk.agent-team",
    ignore: [/[\\/]\.agent-team(?:[\\/]|$)/],
    asar: {
      unpackDir: "{agents,workflows,schemas,templates}",
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "founder-desk",
          productName: "Founder Desk",
          bin: "founder-desk",
          description: "Local workspace for the Solo Founder Agent Team Harness",
          maintainer: "Founder Desk <noreply@localhost>",
          section: "devel",
          priority: "optional",
        },
      },
    },
    {
      name: "@electron-forge/maker-zip",
    },
  ],
};
