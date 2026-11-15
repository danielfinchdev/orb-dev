// Texts of the Órbita html page tile, the PR card and the ACP agents.
export default {
  'htmlpage.expand': 'Ampliar página',
  'htmlpage.expandedTitle': 'Página ampliada',
  'htmlpage.internetOn': 'Internet encendido: esta página puede conectarse a sitios https. Enciéndelo solo si confías en ella.',
  'htmlpage.sandboxHelp': 'La página corre en un sandbox sin acceso a Orb, archivos ni claves. Con internet apagado no puede conectarse. Con internet encendido solo puede usar https. Límite conocido: aun con internet apagado, una página con WebRTC por TURN/TCP podría enviar datos a un servidor (el bloqueo cierra UDP/STUN, no ICE-TCP); cierra las páginas en las que no confíes.',
  'prcard.group': 'Confirmación de pull request #{number}',
  'prcard.acceptMergeMethod': 'Fusionar ({method})',
  'prcard.dangerNote': 'Fusionar cambia la rama base y no se deshace desde Orb. Revisa los checks antes de aceptar.',
  'agents.hermesNote': 'Hermes solo pide permiso para lo que él considera peligroso, así que Orb no puede garantizar que pregunte antes de cada cambio. Actívalo solo si te fías de lo que le encargas.',
  'agents.enable': 'Activar'
};
