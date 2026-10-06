#!/bin/bash
#
# electron-builder's own after-install script, plus what it takes for the app to
# start on Ubuntu 24.04.
#
# Since 24.04 Ubuntu lets a program create user namespaces only when an AppArmor
# profile allows it. Chromium's sandbox is built on them; refused, it falls back
# to the setuid chrome-sandbox helper. The stock script decides that helper's
# mode by trying `unshare --user` itself - as root, which the restriction never
# refuses - so it always concluded namespaces work and left the helper 0755, on
# exactly the systems where they do not. The app then aborted before it showed a
# window. electron-builder 26 grew the same profile; this is that, on 25, with a
# setuid fallback for a system where the profile cannot be loaded.
#
# Runs as the deb's postinst and the rpm's %post. electron-builder fills in the
# executable and sanitizedProductName macros below and refuses any other
# dollar-brace name made only of letters, so no shell variable here is braced.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# The AppArmor profile (build/linux/apparmor-profile).
#
# Only where AppArmor is on, and only if this AppArmor can read the profile:
# 22.04's parser does not know abi/4.0, but 22.04 does not restrict namespaces
# either, so it loses nothing. Inside a chroot - an image being prepared - the
# profile is only copied, and AppArmor loads it with everything else in
# /etc/apparmor.d when that system boots.
profile_active=0
profile_source='/opt/${sanitizedProductName}/resources/apparmor-profile'
profile_target='/etc/apparmor.d/${executable}'
if apparmor_status --enabled >/dev/null 2>&1; then
    if apparmor_parser --skip-kernel-load --debug "$profile_source" >/dev/null 2>&1; then
        cp -f "$profile_source" "$profile_target"
        if [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; then
            profile_active=1
        # -W -T as dh_apparmor does, so updated abstractions are pulled in too.
        elif apparmor_parser --replace --write-cache --skip-read-cache "$profile_target"; then
            profile_active=1
        else
            echo "Could not load the AppArmor profile for ${executable}." >&2
        fi
    else
        echo "This AppArmor cannot read the profile for ${executable}; not installing it." >&2
    fi
fi

# chrome-sandbox: setuid only where the namespace sandbox cannot work - no user
# namespaces at all, or restricted ones without our profile in force. Chromium
# prefers namespaces whenever it can create them, so the setuid helper is a
# fallback, never a replacement; Chrome's own package always ships it that way.
restricted=0
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ]; then
    restricted=1
fi
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; } || { [ "$restricted" = 1 ] && [ "$profile_active" = 0 ]; }; then
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

# A profile that would not load must not leave the package half-configured: the
# fallback above already keeps the app able to start.
exit 0
