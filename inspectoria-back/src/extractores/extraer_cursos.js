const { irAMenu } = require('./sesion_portal.js');

async function extraerCursos(page) {
    await irAMenu(page, 'mensual');

    try {
        const select = page.locator('#mCurso');
        await select.waitFor();

        const textos = await select.locator('option').allTextContents();

        const cursos = textos
            .map((t) => t.trim())
            .filter((t) => t && !/^selecci/i.test(t) && !/^todos/i.test(t));

        return [...new Set(cursos)]; // sin repetidos, en el orden del portal
    } catch (error) {
        const fallo = new Error('El portal cambió y no se encontró el selector de cursos.');
        fallo.code = 'ESTRUCTURA_CAMBIADA';
        fallo.cause = error;
        throw fallo;
    }
}

module.exports = { extraerCursos };