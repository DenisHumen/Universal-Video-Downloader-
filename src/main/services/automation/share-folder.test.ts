import { describe, expect, it } from 'vitest'
import { fromGvfs, fromKioFuse, fromLinuxMounts, fromMacMounts, fromWindows } from './share-folder'

describe('a folder picked on a share, back to the share', () => {
  it('reads GNOME gvfs mounts, login included', () => {
    expect(
      fromGvfs('/run/user/1000/gvfs/smb-share:server=192.168.1.10,share=shared,user=denis/video/series')
    ).toEqual({ host: '192.168.1.10', share: 'shared', folder: 'video/series', username: 'denis', domain: undefined })
    expect(fromGvfs('/run/user/1000/gvfs/smb-share:domain=HOME,server=nas,share=my%20media')).toEqual({
      host: 'nas',
      share: 'my media',
      folder: '',
      username: undefined,
      domain: 'HOME'
    })
    expect(fromGvfs('/run/user/1000/gvfs/sftp:host=nas/home')).toBeNull()
    expect(fromGvfs('/home/denis/Videos')).toBeNull()
  })

  it('reads KDE kio-fuse mounts', () => {
    expect(fromKioFuse('/run/user/1000/kio-fuse-AbCd/smb/denis@nas/shared/video')).toEqual({
      host: 'nas',
      share: 'shared',
      folder: 'video',
      username: 'denis'
    })
    expect(fromKioFuse('/home/denis/smb/nas/shared')).toBeNull()
  })

  it('reads cifs mounts, preferring the deepest and keeping the mount prefix', () => {
    const mounts = [
      '/dev/sda1 / ext4 rw 0 0',
      '//nas/shared /mnt/nas cifs rw,username=denis,domain=HOME 0 0',
      '//nas/media/films /mnt/nas/films smb3 rw,user=guest 0 0',
      '//nas/my\\040stuff /mnt/my\\040stuff cifs rw 0 0'
    ].join('\n')
    expect(fromLinuxMounts('/mnt/nas/video/series', mounts)).toEqual({
      host: 'nas',
      share: 'shared',
      folder: 'video/series',
      username: 'denis',
      domain: 'HOME'
    })
    expect(fromLinuxMounts('/mnt/nas/films/2024', mounts)).toMatchObject({
      share: 'media',
      folder: 'films/2024',
      username: 'guest'
    })
    expect(fromLinuxMounts('/mnt/my stuff/a', mounts)).toMatchObject({ share: 'my stuff', folder: 'a' })
    expect(fromLinuxMounts('/mnt/nasty', mounts)).toBeNull()
    expect(fromLinuxMounts('/home/denis', mounts)).toBeNull()
  })

  it('reads macOS smbfs mounts', () => {
    const mounts = [
      '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
      '//denis@192.168.1.10/shared on /Volumes/shared (smbfs, nodev, nosuid, mounted by denis)',
      '//HOME;ann:@nas._smb._tcp.local/my%20media on /Volumes/my media (smbfs, nodev)'
    ].join('\n')
    expect(fromMacMounts('/Volumes/shared/video/series', mounts)).toEqual({
      host: '192.168.1.10',
      share: 'shared',
      folder: 'video/series',
      username: 'denis'
    })
    expect(fromMacMounts('/Volumes/my media', mounts)).toEqual({
      host: 'nas._smb._tcp.local',
      share: 'my media',
      folder: '',
      username: 'ann',
      domain: 'HOME'
    })
    expect(fromMacMounts('/Users/denis/Movies', mounts)).toBeNull()
  })

  it('reads Windows UNC paths and mapped drives', () => {
    expect(fromWindows('\\\\192.168.1.10\\shared\\video\\series', '')).toEqual({
      host: '192.168.1.10',
      share: 'shared',
      folder: 'video/series'
    })
    const netUse = [
      'Status       Local     Remote                    Network',
      '-------------------------------------------------------------------------------',
      'OK           Z:        \\\\nas\\shared              Microsoft Windows Network',
      'OK           Y:        \\\\nas\\media\\films        Microsoft Windows Network'
    ].join('\r\n')
    expect(fromWindows('z:\\video', netUse)).toMatchObject({ host: 'nas', share: 'shared', folder: 'video' })
    expect(fromWindows('Y:\\', netUse)).toMatchObject({ share: 'media', folder: 'films' })
    expect(fromWindows('C:\\Users\\denis', netUse)).toBeNull()
    expect(fromWindows('\\\\?\\C:\\x', netUse)).toBeNull()
  })
})
